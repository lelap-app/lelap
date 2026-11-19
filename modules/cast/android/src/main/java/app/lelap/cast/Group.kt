package app.lelap.cast

import android.util.Log
import java.util.concurrent.Callable
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * Keeps the other speakers of a group in step with the first, which [RemoteSession] follows (M78).
 * Each speaker fetches and buffers the file itself, over its own protocol, so they start a little
 * apart and drift; a speaker more than [DRIFT_MS] off is moved to the first one's place, plus what
 * it learnt it loses on a seek. Pure: [GroupRenderer] runs the actions.
 */
class GroupSync(private val clock: () -> Long) {
  sealed interface Action {
    val follower: Int

    /** [driftMs]: how far ahead of the first speaker the follower was (behind when negative). */
    data class Seek(override val follower: Int, val positionMs: Long, val driftMs: Long) : Action
    data class Play(override val follower: Int) : Action
    data class Pause(override val follower: Int) : Action
  }

  private class Follower {
    var actedAt = Long.MIN_VALUE / 2
    var seekedAt = Long.MIN_VALUE / 2

    /** How far ahead of the first speaker a seek aims, for the time the follower takes to resume. */
    var leadMs = 0L
  }

  private val followers = mutableMapOf<Int, Follower>()
  private var holdUntil = Long.MIN_VALUE / 2

  /** A follower left the group; the number goes with it. */
  fun forget(follower: Int) {
    followers.remove(follower)
  }

  /** The whole group was just told to play, pause, seek or load: statuses lag it for a moment. */
  fun commanded() {
    holdUntil = clock() + COOLDOWN_MS
  }

  /** The first speaker's status and each follower's (null when it gave none); what to tell them. */
  fun onStatuses(leader: RendererStatus, statuses: Map<Int, RendererStatus?>): List<Action> {
    val now = clock()
    if (now < holdUntil) return emptyList()
    val actions = mutableListOf<Action>()
    for ((i, status) in statuses) {
      status ?: continue
      val f = followers.getOrPut(i, ::Follower)
      if (now - f.actedAt < COOLDOWN_MS) continue
      val action = when (leader.state) {
        PlayState.PLAYING -> when (status.state) {
          // It missed a Play, or the listener paused it on the speaker; the group plays as one.
          PlayState.PAUSED -> Action.Play(i)
          PlayState.PLAYING -> {
            val drift = status.positionMs - leader.positionMs
            if (abs(drift) <= DRIFT_MS) {
              null
            } else {
              // Still off soon after a seek: the seek itself cost that much, so aim further ahead.
              if (now - f.seekedAt < LEARN_WINDOW_MS) f.leadMs = (f.leadMs - drift).coerceIn(0L, MAX_LEAD_MS)
              f.seekedAt = now
              Action.Seek(i, leader.positionMs + f.leadMs, drift)
            }
          }
          else -> null
        }
        PlayState.PAUSED -> if (status.state == PlayState.PLAYING) Action.Pause(i) else null
        else -> null
      }
      if (action != null) {
        f.actedAt = now
        actions += action
      }
    }
    return actions
  }

  companion object {
    /** Further apart than this is heard as an echo between rooms; closer is left alone. */
    const val DRIFT_MS = 1_000L

    /** A follower gets a moment to settle after it was told something. */
    const val COOLDOWN_MS = 8_000L
    const val LEARN_WINDOW_MS = 30_000L
    const val MAX_LEAD_MS = 4_000L
  }
}

/** Each speaker's new volume when the group's goes to [level]: the first one's at [level], the rest in proportion. */
fun groupVolumes(level: Float, volumes: List<Float?>): List<Float> {
  val target = level.coerceIn(0f, 1f)
  val first = volumes.firstOrNull()
  if (first == null || first <= 0f) return volumes.map { target }
  val factor = target / first
  return volumes.mapIndexed { i, v -> if (i == 0 || v == null) target else (v * factor).coerceIn(0f, 1f) }
}

/**
 * Several speakers, of any protocols, as one [Renderer] (M78). The first plays the part of the
 * receiver: its status is the group's, so [RemoteSession] follows it. Commands go to all at once;
 * a follower that fails or goes away leaves the group, and the rest play on.
 */
class GroupRenderer(
  private val leader: Renderer,
  followers: List<Renderer>,
  clock: () -> Long,
  /** For `adb logcat -s LelapCast`: numbers only. */
  private val log: (String) -> Unit = { Log.i(TAG, it) },
) : Renderer {
  private class Member(val number: Int, val renderer: Renderer) {
    @Volatile
    var volume: Float? = null
  }

  private val members = CopyOnWriteArrayList(followers.mapIndexed { i, r -> Member(i, r) })
  private val sync = GroupSync(clock)
  private val pool: ExecutorService = Executors.newCachedThreadPool { Thread(it, "lelap-cast-group").apply { isDaemon = true } }
  private var leaderVolume: Float? = null

  /** The speakers still in the group besides the first. */
  val followerCount: Int
    get() = members.size

  /** A follower's protocol client said it lost its speaker. */
  fun drop(renderer: Renderer) {
    val member = members.firstOrNull { it.renderer === renderer } ?: return
    leave(member, "lost")
  }

  private fun leave(member: Member, why: String) {
    if (!members.remove(member)) return
    synchronized(sync) { sync.forget(member.number) }
    log("group: a speaker left ($why), ${members.size + 1} left")
    pool.execute { runCatching { member.renderer.close() } }
  }

  /** Runs [block] on the leader here and on every follower alongside; a follower that throws leaves. */
  private fun all(block: (Renderer) -> Unit) {
    synchronized(sync) { sync.commanded() }
    val pending = members.map { m -> m to pool.submit(Callable { block(m.renderer) }) }
    try {
      block(leader)
    } finally {
      for ((member, future) in pending) {
        try {
          future.get(FOLLOWER_WAIT_S, TimeUnit.SECONDS)
        } catch (e: Exception) {
          leave(member, "failed")
        }
      }
    }
  }

  override fun load(media: CastMedia, startMs: Long, autoplay: Boolean, speed: Float) = all { it.load(media, startMs, autoplay, speed) }

  override fun play() = all { it.play() }

  override fun pause() = all { it.pause() }

  override fun seek(positionMs: Long) = all { it.seek(positionMs) }

  override fun setSpeed(speed: Float) = all { it.setSpeed(speed) }

  override fun canPlayAt(speed: Float): Boolean = leader.canPlayAt(speed) && members.all { it.renderer.canPlayAt(speed) }

  override fun setVolume(level: Float) {
    val list = members.toList()
    val volumes = groupVolumes(level, listOf(leaderVolume) + list.map { it.volume })
    leader.setVolume(volumes[0])
    list.forEachIndexed { i, m -> runCatching { m.renderer.setVolume(volumes[i + 1]) } }
  }

  override fun status(): RendererStatus {
    val list = members.toList()
    val polls = list.map { m -> m to pool.submit(Callable { m.renderer.status() }) }
    val status = leader.status()
    if (status.volume != null) leaderVolume = status.volume
    val statuses = polls.associate { (m, future) ->
      val s = runCatching { future.get(FOLLOWER_WAIT_S, TimeUnit.SECONDS) }.getOrNull()
      if (s?.volume != null) m.volume = s.volume
      m.number to s
    }
    val actions = synchronized(sync) { sync.onStatuses(status, statuses) }
    for (action in actions) {
      val member = list.firstOrNull { it.number == action.follower } ?: continue
      pool.execute {
        runCatching {
          when (action) {
            is GroupSync.Action.Seek -> member.renderer.seek(action.positionMs)
            is GroupSync.Action.Play -> member.renderer.play()
            is GroupSync.Action.Pause -> member.renderer.pause()
          }
        }
      }
      if (action is GroupSync.Action.Seek) log("group: a speaker was ${action.driftMs} ms off")
    }
    return status
  }

  override fun close() {
    val list = members.toList()
    members.clear()
    for (m in list) pool.execute { runCatching { m.renderer.close() } }
    runCatching { leader.close() }
    pool.shutdown()
  }

  companion object {
    private const val TAG = "LelapCast"

    /** A follower slower than this to load or answer leaves rather than holding up the group. */
    const val FOLLOWER_WAIT_S = 25L
  }
}

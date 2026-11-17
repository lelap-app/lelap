package app.lelap.widget

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import app.lelap.text.NativeText

/** Quick Settings tile: play or pause the current book. A long press opens the player. */
class PlayTileService : TileService() {
  override fun onStartListening() {
    render(Models.tile(NowPlayingSnapshot.read(this), NativeText.get(this)))
  }

  override fun onClick() {
    val now = Models.tile(NowPlayingSnapshot.read(this), NativeText.get(this))
    // Flip at once; PlaybackService's broadcast then confirms the real state.
    render(now.copy(state = if (now.state == TileState.ACTIVE) TileState.INACTIVE else TileState.ACTIVE))
    PlayerRemote.send(this, PlayerRemote.Action.PLAY_PAUSE)
  }

  private fun render(model: TileModel) {
    val tile = qsTile ?: return
    tile.state = if (model.state == TileState.ACTIVE) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    tile.label = model.label
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.subtitle = model.subtitle
    tile.contentDescription = "${model.label}, ${model.subtitle}"
    tile.updateTile()
  }
}

/** Android sends a long press on the tile to this activity; it opens the player. */
class TileLongPressActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    startActivity(Links.playerIntent(this))
    finish()
  }
}

package app.lelap.headless

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SandboxRulesTest {
  @Test
  fun loadsOnlyTheInlinePage() {
    assertTrue(SandboxRules.mayLoad("about:blank"))
    assertFalse(SandboxRules.mayLoad("https://example.org/steal?token=1"))
    assertFalse(SandboxRules.mayLoad("intent://x#Intent;end"))
    assertFalse(SandboxRules.mayLoad("file:///data/data/app.lelap/databases/lelap.db"))
    assertFalse(SandboxRules.mayLoad("javascript:alert(1)"))
    assertFalse(SandboxRules.mayLoad(null))
  }

  @Test
  fun quotesEveryCharacterThatCouldEndTheString() {
    assertEquals("\"a\\\"b\\\\c\"", SandboxRules.quote("a\"b\\c"))
    assertEquals("\"\\n\\r\\u2028\\u2029\\u0000\"", SandboxRules.quote("\n\r  \u0000"))
    assertEquals("\"</script>\"", SandboxRules.quote("</script>"))
  }

  @Test
  fun deliversAMessageEventOnTheDocument() {
    val script = SandboxRules.deliver("{\"t\":\"call\",\"id\":\"c1\"}')});alert(1);//")
    assertEquals(
      "(function(){document.dispatchEvent(new MessageEvent('message',{data:" +
        "\"{\\\"t\\\":\\\"call\\\",\\\"id\\\":\\\"c1\\\"}')});alert(1);//\"" +
        "}));})();",
      script,
    )
  }

  @Test
  fun eachKindHasItsOwnWork() {
    assertEquals("lelap-server-task-places", ServerTasks.workName(ServerTasks.PLACES))
    assertEquals("lelap-server-task-locate", ServerTasks.workName(ServerTasks.LOCATE))
    assertTrue(ServerTasks.timeoutMs(ServerTasks.LOCATE) < ServerTasks.timeoutMs(ServerTasks.PLACES))
  }
}

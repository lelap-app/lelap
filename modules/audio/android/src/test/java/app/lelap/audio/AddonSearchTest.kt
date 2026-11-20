package app.lelap.audio

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AddonSearchTest {
  private val catalog = SearchCatalog("https://catalog.example.org/librivox/", "audiobook", "top", "LibriVox")

  @Test fun `the search address is encoded as the sdk encodes it`() {
    assertEquals(
      "https://catalog.example.org/librivox/catalog/audiobook/top/search=pride%20%26%20prejudice!.json",
      AddonSearch.url(catalog, "pride & prejudice!"),
    )
    assertEquals("caf%C3%A9%2Fbar~*'()", AddonSearch.encode("café/bar~*'()"))
  }

  @Test fun `metas become hits, the unnamed skipped`() {
    val body = """{"metas":[
      {"id":"lv:1","type":"audiobook","name":"Emma","author":"Jane Austen","cover":"https://img/1.jpg"},
      {"id":"lv:2","type":"audiobook","name":""},
      {"id":"lv:3","name":"Persuasion","cover":"http://img/3.jpg"}
    ]}"""
    val hits = AddonSearch.parse(body, catalog)
    assertEquals(listOf("lv:1", "lv:3"), hits.map { it.id })
    assertEquals("Jane Austen", hits[0].author)
    assertEquals("audiobook", hits[1].type)
    // Only covers the car can fetch safely.
    assertNull(hits[1].cover)
    assertEquals(emptyList<AddonHit>(), AddonSearch.parse("not json", catalog))
  }

  @Test fun `media IDs carry the type and an ID with slashes`() {
    val hit = AddonHit("audiobook", "ia:some/item", "X", null, null, "Archive")
    assertEquals("addon:audiobook/ia:some/item", AddonSearch.mediaId(hit))
    assertEquals("audiobook" to "ia:some/item", AddonSearch.parseMediaId(AddonSearch.mediaId(hit)))
    assertNull(AddonSearch.parseMediaId("search/abc"))
    assertNull(AddonSearch.parseMediaId("addon:audiobook/"))
  }

  @Test fun `catalogs survive their encoding, non-web ones dropped`() {
    val encoded = AddonSearch.encodeCatalogs(listOf(catalog))
    encoded.put(org.json.JSONObject().put("base", "lelap-local://x/").put("type", "audiobook").put("id", "a"))
    assertEquals(listOf(catalog), AddonSearch.decodeCatalogs(JSONArray(encoded.toString())))
  }

  @Test fun `nothing to ask returns at once`() {
    assertEquals(emptyList<AddonHit>(), AddonSearch.search(emptyList(), "dune"))
    assertEquals(emptyList<AddonHit>(), AddonSearch.search(listOf(catalog), " "))
  }
}

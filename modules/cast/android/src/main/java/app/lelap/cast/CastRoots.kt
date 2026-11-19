package app.lelap.cast

import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64

/**
 * Google's two Cast root certificates, the only ones Chromium trusts for device authentication:
 * the bytes of `cast_root_ca_cert_der-inc.h` and `eureka_root_ca_der-inc.h` in Open Screen's
 * `cast/common/certificate`, identical to the copies Chromium kept in `components/cast_certificate`
 * before it moved them there (M78). Each is checked against its SHA-256 fingerprint on load, so an
 * edited byte drops the root instead of trusting something else.
 */
object CastRoots {
  private class Root(val sha256: String, val der: String)

  private val ROOTS = listOf(
    // C=US, O=Google Inc, OU=Cast, CN=Cast Root CA; 2014-04-02 to 2034-03-28.
    Root(
      "809af14700b3fe2611ad597eb1584d6354313b64ccdb3390f097fa3e5826d6ca",
      "MIIDxTCCAq2gAwIBAgIBAjANBgkqhkiG9w0BAQUFADB1MQswCQYDVQQGEwJVUzETMBEGA1UECAwKQ2FsaWZvcm5pYTEWMBQGA1UE" +
        "BwwNTW91bnRhaW4gVmlldzETMBEGA1UECgwKR29vZ2xlIEluYzENMAsGA1UECwwEQ2FzdDEVMBMGA1UEAwwMQ2FzdCBSb290IENB" +
        "MB4XDTE0MDQwMjE3MzQyNloXDTM0MDMyODE3MzQyNlowdTELMAkGA1UEBhMCVVMxEzARBgNVBAgMCkNhbGlmb3JuaWExFjAUBgNV" +
        "BAcMDU1vdW50YWluIFZpZXcxEzARBgNVBAoMCkdvb2dsZSBJbmMxDTALBgNVBAsMBENhc3QxFTATBgNVBAMMDENhc3QgUm9vdCBD" +
        "QTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALrZZZ3aOdPBd/bU0K6PWAhoOUqV7XDP/XkIqarl6binLaBnR4qeyc9w" +
        "swWHaRHscJiXw+bDw+u9xrA9/E/BXjif2s9zMAZbeTfBXoyHR5SaQZIq1pXEcVwnXQixgMaSvRvjQZeh7HWfVZ4+n48cx2VkB9Oz" +
        "lqEEn5HE3gp7bNnIwHgxoBlCqeiD48788c7CLiRGlQkZysBGsuUButdP87/2aa2ZBPqgBzkO5t9RRwfA5KlcS5TFL7OgMH/nlWuy" +
        "rzIN8YzVbct7R6cIq8sno03PSlrxBdH4YsUQKnRpquZLlvub2GPkWGbTrYpu/3te+aVWHi2CMVvw4iTmQUofrhMCAwEAAaNgMF4w" +
        "DwYDVR0TBAgwBgEB/wIBAjAdBgNVHQ4EFgQUfJoefd95VLzXzF7KmYZFeWV0KBkwHwYDVR0jBBgwFoAUfJoefd95VLzXzF7KmYZF" +
        "eWV0KBkwCwYDVR0PBAQDAgEGMA0GCSqGSIb3DQEBBQUAA4IBAQCA9Fr7PSgZUSDX1PsSl0pl8lg1kncwavHXtlEaf5rNx3sDQq1V" +
        "agCv8OEGwr1reHXb/kERU0o5u5o6xlk0Lywz47LWXH/deOtxWznag5DFMeI/I+/a6ystd17ew0PSyWtZgsrV7fqhZFvL8Q0aYuGc" +
        "6KcYcPBfF5b47Ybbrh3gzz5dLu4WbZUrPP2X8wVaJGhNObb45Fi69eAmeFHFW11OCeVsR4t6Wi6JU+bMNlsmPPhyQwKC0ivN8NOj" +
        "7BM+UtWDPQfcHUNlejMCAaPOt9ZgUTsJwiOKMv6YGWBik4XNNEbb1SMPedp3ACoCbYNYzgN3NeGjIJPCSqKkRhx1LB9N",
    ),
    // C=US, O=Google Inc, OU=Google TV, CN=Eureka Root CA; 2012-12-17 to 2032-12-12. The first
    // Chromecasts chain to it.
    Root(
      "caf6d1e37b532203e01a76bf07187bb731ccd38801565ab2211a2c0ab7f3bc46",
      "MIIDwzCCAqugAwIBAgIBATANBgkqhkiG9w0BAQUFADB8MQswCQYDVQQGEwJVUzETMBEGA1UECAwKQ2FsaWZvcm5pYTEWMBQGA1UE" +
        "BwwNTW91bnRhaW4gVmlldzETMBEGA1UECgwKR29vZ2xlIEluYzESMBAGA1UECwwJR29vZ2xlIFRWMRcwFQYDVQQDDA5FdXJla2Eg" +
        "Um9vdCBDQTAeFw0xMjEyMTcyMjM5MzNaFw0zMjEyMTIyMjM5MzNaMHwxCzAJBgNVBAYTAlVTMRMwEQYDVQQIDApDYWxpZm9ybmlh" +
        "MRYwFAYDVQQHDA1Nb3VudGFpbiBWaWV3MRMwEQYDVQQKDApHb29nbGUgSW5jMRIwEAYDVQQLDAlHb29nbGUgVFYxFzAVBgNVBAMM" +
        "DkV1cmVrYSBSb290IENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuRHQ6hLcMuHfXDNrGXMdnZ7QOXa/pYQJpv1u" +
        "bencjzZO6YgCvZ/06ET9TPWaAlZqRypjbFhFzHxmJNx5ecMqpLKLoPeitc0Gftu+7AyG8g0kYHSEyikjhALYp+078ewmR1TjsS3m" +
        "ZA/2csXpmFIXwPzyLCDIQPhHyTKeO5exi/WYJHBjZhnBUugEBT1fjbzYS693mG8feNG2UCdN5OwUaWcfWK+poBEmPJQyB3/X6Wkf" +
        "rj9PY4qPidbyGXhcIY6xtlfYwOHufW7d8ToKavG6//mDL9y1pCAXYzbvyGIZzFbOsuoxiUt4WMG/AxOZ4BLyiKqblNrddnkXHjTR" +
        "CsQHRQIDAQABo1AwTjAdBgNVHQ4EFgQURE4qR1jYuUiR9k/OdKkdMpqNjekwHwYDVR0jBBgwFoAURE4qR1jYuUiR9k/OdKkdMpqN" +
        "jekwDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQUFAAOCAQEAP8gmoG5cBUB5oZipM95odIXurrccM1mwEd6f9E/T61EJfUd+blGF" +
        "9FTNg5glsbqwV+yT2xLi7FFJepZzm8iWbYWM0+E8+jLiWAx3bYcMNAGqMKl24MDn214b6RAwpOAJSSa5WM1aB+VQdd6aO/ZTfrFT" +
        "XkUnTxfjCDOyUAq79PwllyneQXUw+nc4qmWKc0/qEXvrfBdgJw68PnZS2IvtGvjrN7sR/a5wFwr+4K0Gsx9pinIEwsAzC9YvY0wz" +
        "ERS4YjaIxQNlARmj7wC7bw6S/zQcodYx0Fxen5l9x8q9fHIL9Fylfm4EqNKZLFEBFP6iSPB+voQNtNPi8w593ov1Mw==",
    ),
  )

  /** The roots whose bytes still match their fingerprints. */
  val all: List<X509Certificate> by lazy {
    val factory = CertificateFactory.getInstance("X.509")
    ROOTS.mapNotNull { root ->
      val der = Base64.getDecoder().decode(root.der)
      if (hex(MessageDigest.getInstance("SHA-256").digest(der)) != root.sha256) return@mapNotNull null
      factory.generateCertificate(der.inputStream()) as X509Certificate
    }
  }

  fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}

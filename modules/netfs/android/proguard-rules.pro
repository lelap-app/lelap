# Bouncy Castle's provider finds its algorithms by class name, and sshj loads the provider by name.
-keep class org.bouncycastle.jcajce.provider.** { *; }
-keep class org.bouncycastle.jce.provider.BouncyCastleProvider { *; }
# smbj's event bus (mbassador) calls its handlers by reflection.
-keep class net.engio.mbassy.** { *; }
-keepclassmembers class com.hierynomus.** { @net.engio.mbassy.listener.Handler *; }
# Optional parts of the libraries Android has no classes for: mbassador's EL filters, Kerberos,
# JNDI, other loggers.
-dontwarn javax.el.**
-dontwarn javax.naming.**
-dontwarn javax.security.auth.kerberos.**
-dontwarn org.ietf.jgss.**
-dontwarn org.slf4j.**
-dontwarn sun.security.**
-dontwarn com.jcraft.jzlib.**

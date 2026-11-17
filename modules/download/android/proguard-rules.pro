# WorkManager creates its Room database by reflection; R8 in release builds removes the
# constructor of the generated class unless it is kept (the app crashed at start without this).
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# Multi-Output Audio

A small Windows system-tray utility that plays your sound on **several outputs at
once** — Bluetooth headphones, USB speakers, Wi-Fi/network audio devices — by
simply ticking the outputs you want. Devices are detected automatically,
including ones that connect after the app is running.

## How to use it

1. Run `MultiOutputAudio.exe`. It appears as a white speaker icon in the system
   tray (near the clock) — there is no window by default.
2. **Right-click** the tray icon: every playback device Windows knows about is
   listed with its type (Bluetooth / USB / Wi-Fi / HDMI). **Click a device to
   tick it** — it immediately starts playing the same audio as your main output.
   Click again to untick it.
3. **Left-click** the tray icon to open the full window, which shows the same
   list with checkboxes, plus a **Use as source** button to change which device
   is the main output.
4. Ticked devices are remembered. If a Bluetooth speaker disconnects and later
   reconnects, mirroring to it resumes automatically.
5. Choose **Exit** in the tray menu to quit (closing the window only hides it
   back to the tray).

## How it works

Windows has no built-in way to send one audio stream to several devices, so the
app uses the same technique as tools like VoiceMeeter: it opens a WASAPI
*loopback capture* of the **source** output (your Windows default device) and
mirrors that stream in real time to every other ticked output. That means:

- The source output is always on — it is where apps actually play. To silence
  it, move the source to another device with **Use as source**.
- Mirrored outputs play ~0.2 s behind the source (Bluetooth adds its own delay
  on top). Perfect in separate rooms; side-by-side speakers may have a slight
  echo. Outputs that drift more than a second are re-synced automatically.
- **Wi-Fi speakers** (Chromecast, AirPlay, Sonos, DLNA) appear only if they are
  visible to Windows as a playback device — i.e. their driver or companion app
  (e.g. an AirPlay/DLNA bridge) creates an audio endpoint. Anything listed under
  Windows **Settings → Sound → Output** will show up here.

## Download / build

- Download `MultiOutputAudio.exe` from this repository's **Releases** (tags
  starting with `audio-v`), or grab the build artifact from the
  `build-multi-output-audio` GitHub Actions run.
- Or build it yourself with the .NET 8 SDK:

  ```
  dotnet publish multi-output-audio/MultiOutputAudio.csproj -c Release -r win-x64 --self-contained -p:PublishSingleFile=true
  ```

No installer and no admin rights needed — it is a single portable exe. To start
it with Windows, put a shortcut to it in the `shell:startup` folder.

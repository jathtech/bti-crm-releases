using System.Text;
using NAudio.CoreAudioApi;

namespace MultiOutputAudio;

public enum DeviceKind
{
    Unknown,
    Bluetooth,
    Usb,
    Network,
    Hdmi,
}

/// <summary>
/// Best-effort classification of a render endpoint as Bluetooth / USB /
/// Wi-Fi-network / HDMI, based on its form factor and the hardware ids and
/// interface paths found in its property store.
/// </summary>
public static class DeviceKindDetector
{
    private const int FormFactorRemoteNetworkDevice = 0;
    private const int FormFactorDigitalAudioDisplayDevice = 9;

    public static DeviceKind Detect(MMDevice device)
    {
        try
        {
            var store = device.Properties;
            if (store.Contains(PropertyKeys.PKEY_AudioEndpoint_FormFactor))
            {
                var value = store[PropertyKeys.PKEY_AudioEndpoint_FormFactor]?.Value;
                var formFactor = value switch { uint u => (int)u, int i => i, _ => -1 };
                if (formFactor == FormFactorRemoteNetworkDevice) return DeviceKind.Network;
                if (formFactor == FormFactorDigitalAudioDisplayDevice) return DeviceKind.Hdmi;
            }

            var text = new StringBuilder(device.FriendlyName);
            for (var i = 0; i < store.Count; i++)
            {
                try
                {
                    if (store[i]?.Value is string s) text.Append('\n').Append(s);
                }
                catch
                {
                    // Some property values do not marshal; skip them.
                }
            }

            var all = text.ToString().ToLowerInvariant();
            if (all.Contains("bthenum") || all.Contains("bthhfenum") || all.Contains("bluetooth"))
                return DeviceKind.Bluetooth;
            if (all.Contains(@"usb\") || all.Contains("usb#") || all.Contains("usbaudio") || all.Contains("(usb"))
                return DeviceKind.Usb;
            if (all.Contains("airplay") || all.Contains("chromecast") || all.Contains("googlecast") ||
                all.Contains("dlna") || all.Contains("sonos") || all.Contains("wi-fi") || all.Contains("wifi"))
                return DeviceKind.Network;
            if (all.Contains("hdmi") || all.Contains("displayport"))
                return DeviceKind.Hdmi;
        }
        catch
        {
            // Classification is cosmetic; never let it break enumeration.
        }
        return DeviceKind.Unknown;
    }

    public static string Label(DeviceKind kind) => kind switch
    {
        DeviceKind.Bluetooth => "Bluetooth",
        DeviceKind.Usb => "USB",
        DeviceKind.Network => "Wi-Fi / Network",
        DeviceKind.Hdmi => "HDMI / Display",
        _ => "Built-in / Other",
    };
}

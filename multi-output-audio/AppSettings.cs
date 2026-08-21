using System.Text.Json;

namespace MultiOutputAudio;

public sealed class AppSettings
{
    /// <summary>Endpoint ids the user has ticked; re-applied automatically when a device reappears.</summary>
    public HashSet<string> ActiveDeviceIds { get; set; } = new();

    public bool ShownTrayHint { get; set; }

    private static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "MultiOutputAudio", "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();
        }
        catch
        {
            // A corrupt settings file should never stop the app from starting.
        }
        return new AppSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // Persistence is best-effort.
        }
    }
}

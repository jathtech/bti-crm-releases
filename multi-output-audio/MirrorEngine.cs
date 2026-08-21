using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MultiOutputAudio;

/// <summary>
/// Mirrors whatever the source render device is playing onto any number of
/// additional render devices, using a WASAPI loopback capture of the source.
/// </summary>
public sealed class MirrorEngine : IDisposable
{
    private const int OutputLatencyMs = 200;

    // If an output's buffer drifts more than this behind live, it is re-synced.
    private static readonly TimeSpan MaxDrift = TimeSpan.FromSeconds(1);

    /// <summary>Pseudo device id used for errors that concern the capture side.</summary>
    public const string SourceErrorKey = "*source*";

    private readonly object configLock = new();
    private readonly object targetsLock = new();
    private WasapiLoopbackCapture? capture;
    private List<Target> targets = new();
    private bool disposed;

    /// <summary>Raised (on a worker thread) when the loopback capture dies unexpectedly.</summary>
    public event EventHandler? CaptureStopped;

    private sealed class Target : IDisposable
    {
        public required string DeviceId { get; init; }
        public required MMDevice Device { get; init; }
        public required WasapiOut Output { get; init; }
        public required BufferedWaveProvider Buffer { get; init; }

        public void Dispose()
        {
            try { Output.Stop(); } catch { /* device may already be gone */ }
            try { Output.Dispose(); } catch { }
            try { Device.Dispose(); } catch { }
        }
    }

    /// <summary>
    /// Tears down the current pipeline and rebuilds it: loopback-capture
    /// <paramref name="sourceDeviceId"/> and mirror it to every id in
    /// <paramref name="targetDeviceIds"/>. Returns per-device error messages for
    /// anything that could not be started; the remaining outputs keep playing.
    /// </summary>
    public Dictionary<string, string> Configure(string? sourceDeviceId, IReadOnlyCollection<string> targetDeviceIds)
    {
        var errors = new Dictionary<string, string>();
        lock (configLock)
        {
            TearDown();
            if (disposed || sourceDeviceId is null || targetDeviceIds.Count == 0)
                return errors;

            using var enumerator = new MMDeviceEnumerator();
            MMDevice? sourceDevice = null;
            try
            {
                sourceDevice = enumerator.GetDevice(sourceDeviceId);
                capture = new WasapiLoopbackCapture(sourceDevice);
                capture.DataAvailable += OnDataAvailable;
                capture.RecordingStopped += OnRecordingStopped;
            }
            catch (Exception ex)
            {
                errors[SourceErrorKey] = ex.Message;
                try { sourceDevice?.Dispose(); } catch { }
                capture = null;
                return errors;
            }

            var newTargets = new List<Target>();
            foreach (var id in targetDeviceIds.Distinct())
            {
                if (id == sourceDeviceId) continue;
                try
                {
                    var device = enumerator.GetDevice(id);
                    var buffer = new BufferedWaveProvider(capture.WaveFormat)
                    {
                        BufferDuration = TimeSpan.FromSeconds(5),
                        DiscardOnBufferOverflow = true,
                    };
                    var output = new WasapiOut(device, AudioClientShareMode.Shared, false, OutputLatencyMs);
                    output.Init(buffer);
                    output.Play();
                    newTargets.Add(new Target { DeviceId = id, Device = device, Output = output, Buffer = buffer });
                }
                catch (Exception ex)
                {
                    errors[id] = ex.Message;
                }
            }

            lock (targetsLock) targets = newTargets;

            if (newTargets.Count == 0)
            {
                TearDown();
                return errors;
            }

            try
            {
                capture.StartRecording();
            }
            catch (Exception ex)
            {
                errors[SourceErrorKey] = ex.Message;
                TearDown();
            }
        }
        return errors;
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        lock (targetsLock)
        {
            foreach (var target in targets)
            {
                if (target.Buffer.BufferedDuration > MaxDrift) target.Buffer.ClearBuffer();
                try { target.Buffer.AddSamples(e.Buffer, 0, e.BytesRecorded); } catch { }
            }
        }
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception != null) CaptureStopped?.Invoke(this, EventArgs.Empty);
    }

    // Must be called under configLock. The capture is disposed before the
    // targets so its worker thread can never block on targetsLock while we
    // hold it here.
    private void TearDown()
    {
        var oldCapture = capture;
        capture = null;
        if (oldCapture != null)
        {
            oldCapture.DataAvailable -= OnDataAvailable;
            oldCapture.RecordingStopped -= OnRecordingStopped;
            try { oldCapture.StopRecording(); } catch { }
            try { oldCapture.Dispose(); } catch { }
        }

        List<Target> oldTargets;
        lock (targetsLock)
        {
            oldTargets = targets;
            targets = new List<Target>();
        }
        foreach (var target in oldTargets) target.Dispose();
    }

    public void Dispose()
    {
        lock (configLock)
        {
            disposed = true;
            TearDown();
        }
    }
}

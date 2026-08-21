using System.Drawing.Drawing2D;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace MultiOutputAudio;

/// <summary>
/// Tray-first UI: the app lives as a system-tray icon whose right-click menu
/// lists every detected playback device with a checkmark. Left-clicking the
/// icon opens this window, which shows the same devices in a checkable list
/// plus a "Use as source" action. Closing the window hides it back to the tray.
/// </summary>
public sealed class MainForm : Form
{
    private sealed record DeviceRow(string Id, string Name, DeviceKind Kind, bool IsSource, bool IsActive);

    private readonly MMDeviceEnumerator enumerator = new();
    private readonly MirrorEngine engine = new();
    private readonly AppSettings settings = AppSettings.Load();

    private readonly ListView listView;
    private readonly ToolStripStatusLabel statusLabel;
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip trayMenu;
    private readonly Icon trayIcon;
    private readonly System.Windows.Forms.Timer refreshDebounce = new() { Interval = 400 };

    private NotificationClient? notificationClient;
    private List<DeviceRow> rows = new();
    private string? defaultDeviceId;
    private string? lastAppliedSource;
    private List<string> lastAppliedTargets = new();
    private bool forceReconfigure = true;
    private bool suppressCheckEvents;
    private bool allowVisible;
    private bool exiting;

    public MainForm()
    {
        Text = "Multi-Output Audio";
        ClientSize = new Size(620, 380);
        MinimumSize = new Size(520, 320);
        StartPosition = FormStartPosition.CenterScreen;

        listView = new ListView
        {
            Dock = DockStyle.Fill,
            View = View.Details,
            CheckBoxes = true,
            FullRowSelect = true,
            MultiSelect = false,
            HeaderStyle = ColumnHeaderStyle.Nonclickable,
        };
        listView.Columns.Add("Output", 300);
        listView.Columns.Add("Type", 110);
        listView.Columns.Add("Status", 180);
        listView.ItemChecked += OnItemChecked;

        var infoLabel = new Label
        {
            Dock = DockStyle.Top,
            AutoSize = false,
            Height = 72,
            Padding = new Padding(10, 8, 10, 4),
            Text = "Tick every output that should play sound. Audio always plays on the source output " +
                   "(the Windows default device); every other ticked output mirrors it live. Select a row and " +
                   "click “Use as source” to move the source. Bluetooth, USB and Wi-Fi outputs are " +
                   "detected automatically, including when they connect later.",
        };

        var buttonPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
            Padding = new Padding(6),
        };
        var useAsSourceButton = new Button { Text = "Use as source", AutoSize = true };
        useAsSourceButton.Click += OnUseAsSource;
        var refreshButton = new Button { Text = "Refresh", AutoSize = true };
        refreshButton.Click += (_, _) => RefreshDevices();
        buttonPanel.Controls.Add(useAsSourceButton);
        buttonPanel.Controls.Add(refreshButton);

        var statusStrip = new StatusStrip();
        statusLabel = new ToolStripStatusLabel { Spring = true, TextAlign = ContentAlignment.MiddleLeft };
        statusStrip.Items.Add(statusLabel);

        Controls.Add(listView);
        Controls.Add(infoLabel);
        Controls.Add(buttonPanel);
        Controls.Add(statusStrip);

        trayIcon = CreateTrayIcon();
        Icon = trayIcon;
        trayMenu = new ContextMenuStrip();
        tray = new NotifyIcon
        {
            Icon = trayIcon,
            Text = "Multi-Output Audio",
            Visible = true,
            ContextMenuStrip = trayMenu,
        };
        tray.MouseUp += (_, e) => { if (e.Button == MouseButtons.Left) ShowWindow(); };

        refreshDebounce.Tick += (_, _) => RefreshDevices();
        engine.CaptureStopped += (_, _) => OnDevicesChangedFromCallback(captureDied: true);

        // Force handle creation now: the form starts hidden (never "shown"),
        // but BeginInvoke from device-notification threads needs a handle.
        _ = Handle;

        notificationClient = new NotificationClient(this);
        enumerator.RegisterEndpointNotificationCallback(notificationClient);

        RefreshDevices();
        ShowTrayHintOnce();
    }

    // The form starts hidden in the tray; only ShowWindow() may make it visible.
    protected override void SetVisibleCore(bool value)
    {
        base.SetVisibleCore(allowVisible && value);
    }

    private void ShowWindow()
    {
        allowVisible = true;
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            ShowTrayHintOnce();
            return;
        }
        base.OnFormClosing(e);
    }

    private void ShowTrayHintOnce()
    {
        if (settings.ShownTrayHint) return;
        settings.ShownTrayHint = true;
        settings.Save();
        tray.BalloonTipTitle = "Multi-Output Audio is running";
        tray.BalloonTipText = "Right-click the speaker icon to tick outputs. Left-click opens the window. Use “Exit” in the menu to quit.";
        tray.ShowBalloonTip(5000);
    }

    private void ExitApp()
    {
        exiting = true;
        tray.Visible = false;
        Close();
        Application.Exit();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (notificationClient != null)
            {
                try { enumerator.UnregisterEndpointNotificationCallback(notificationClient); } catch { }
                notificationClient = null;
            }
            refreshDebounce.Dispose();
            engine.Dispose();
            tray.Dispose();
            trayMenu.Dispose();
            try { enumerator.Dispose(); } catch { }
        }
        base.Dispose(disposing);
    }

    // ----- Device discovery ---------------------------------------------

    private void OnDevicesChangedFromCallback(bool captureDied = false)
    {
        try
        {
            if (!IsHandleCreated) return;
            BeginInvoke(() =>
            {
                if (captureDied) forceReconfigure = true;
                refreshDebounce.Stop();
                refreshDebounce.Start();
            });
        }
        catch
        {
            // The form may be disposing; nothing to do.
        }
    }

    private void RefreshDevices()
    {
        refreshDebounce.Stop();

        string? defId = null;
        try
        {
            using var def = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            defId = def.ID;
        }
        catch
        {
            // No default render device (e.g. no devices at all).
        }
        defaultDeviceId = defId;

        var newRows = new List<DeviceRow>();
        try
        {
            foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
            {
                using (device)
                {
                    var id = device.ID;
                    newRows.Add(new DeviceRow(
                        id,
                        device.FriendlyName,
                        DeviceKindDetector.Detect(device),
                        id == defId,
                        settings.ActiveDeviceIds.Contains(id)));
                }
            }
        }
        catch (Exception ex)
        {
            statusLabel.Text = "Could not list playback devices: " + ex.Message;
        }
        rows = newRows;

        PopulateListView();
        RebuildTrayMenu();
        ApplyEngine();
    }

    private void PopulateListView()
    {
        suppressCheckEvents = true;
        listView.BeginUpdate();
        listView.Items.Clear();
        foreach (var row in rows)
        {
            var item = new ListViewItem(row.Name) { Tag = row.Id, Checked = row.IsSource || row.IsActive };
            item.SubItems.Add(DeviceKindDetector.Label(row.Kind));
            item.SubItems.Add(row.IsSource ? "Source (Windows default)" : row.IsActive ? "Mirroring" : "Off");
            listView.Items.Add(item);
        }
        listView.EndUpdate();
        suppressCheckEvents = false;
    }

    private void RebuildTrayMenu()
    {
        trayMenu.Items.Clear();
        trayMenu.Items.Add(new ToolStripMenuItem("Multi-Output Audio — outputs") { Enabled = false });
        trayMenu.Items.Add(new ToolStripSeparator());

        if (rows.Count == 0)
        {
            trayMenu.Items.Add(new ToolStripMenuItem("No playback devices found") { Enabled = false });
        }
        foreach (var row in rows)
        {
            var text = $"{row.Name}  [{DeviceKindDetector.Label(row.Kind)}]" + (row.IsSource ? "  (source)" : "");
            var item = new ToolStripMenuItem(text)
            {
                Checked = row.IsSource || row.IsActive,
                Enabled = !row.IsSource,
                Tag = row.Id,
                ToolTipText = row.IsSource
                    ? "The source output is always on. Open the window to move the source."
                    : "Click to toggle this output",
            };
            item.Click += (sender, _) =>
            {
                var id = (string)((ToolStripMenuItem)sender!).Tag!;
                SetDeviceActive(id, !settings.ActiveDeviceIds.Contains(id));
            };
            trayMenu.Items.Add(item);
        }

        trayMenu.Items.Add(new ToolStripSeparator());
        var open = new ToolStripMenuItem("Open window…");
        open.Click += (_, _) => ShowWindow();
        var refresh = new ToolStripMenuItem("Refresh devices");
        refresh.Click += (_, _) => RefreshDevices();
        var exit = new ToolStripMenuItem("Exit");
        exit.Click += (_, _) => ExitApp();
        trayMenu.Items.Add(open);
        trayMenu.Items.Add(refresh);
        trayMenu.Items.Add(exit);
    }

    // ----- Toggling and engine wiring -----------------------------------

    private void OnItemChecked(object? sender, ItemCheckedEventArgs e)
    {
        if (suppressCheckEvents) return;
        var id = (string)e.Item.Tag!;
        if (id == defaultDeviceId && !e.Item.Checked)
        {
            suppressCheckEvents = true;
            e.Item.Checked = true;
            suppressCheckEvents = false;
            statusLabel.Text = "The source output is always on — select another row and press “Use as source” to move it.";
            return;
        }
        SetDeviceActive(id, e.Item.Checked);
    }

    private void SetDeviceActive(string id, bool active)
    {
        if (active) settings.ActiveDeviceIds.Add(id);
        else settings.ActiveDeviceIds.Remove(id);
        settings.Save();
        // Deferred: this can be called from inside the ListView's own
        // ItemChecked event, and RefreshDevices rebuilds the list.
        BeginInvoke(RefreshDevices);
    }

    private void OnUseAsSource(object? sender, EventArgs e)
    {
        if (listView.SelectedItems.Count == 0)
        {
            statusLabel.Text = "Select a device in the list first, then press “Use as source”.";
            return;
        }
        var id = (string)listView.SelectedItems[0].Tag!;
        if (id == defaultDeviceId) return;
        try
        {
            // Keep the old source audible: it becomes a mirrored output.
            if (defaultDeviceId != null) settings.ActiveDeviceIds.Add(defaultDeviceId);
            settings.ActiveDeviceIds.Add(id);
            settings.Save();
            DefaultDeviceSetter.SetDefault(id);
            BeginInvoke(RefreshDevices);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Could not change the default output: " + ex.Message,
                "Multi-Output Audio", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void ApplyEngine()
    {
        var targets = rows.Where(r => r.IsActive && !r.IsSource).Select(r => r.Id).OrderBy(x => x).ToList();
        var activeCount = targets.Count + (defaultDeviceId != null ? 1 : 0);
        tray.Text = TrimTrayText(activeCount <= 1
            ? "Multi-Output Audio — source only"
            : $"Multi-Output Audio — {activeCount} outputs active");

        if (!forceReconfigure && defaultDeviceId == lastAppliedSource && targets.SequenceEqual(lastAppliedTargets))
            return;
        forceReconfigure = false;
        lastAppliedSource = defaultDeviceId;
        lastAppliedTargets = targets;

        var errors = engine.Configure(defaultDeviceId, targets);

        foreach (ListViewItem item in listView.Items)
        {
            var id = (string)item.Tag!;
            if (errors.TryGetValue(id, out var message))
                item.SubItems[2].Text = "Error: " + Shorten(message);
        }

        if (defaultDeviceId == null)
            statusLabel.Text = "No playback devices found.";
        else if (errors.TryGetValue(MirrorEngine.SourceErrorKey, out var sourceError))
            statusLabel.Text = "Could not capture the source output: " + Shorten(sourceError);
        else if (targets.Count == 0)
            statusLabel.Text = "Playing on the source output only. Tick more outputs to mirror to them.";
        else
            statusLabel.Text = $"Mirroring the source to {targets.Count} extra output(s).";
    }

    private static string Shorten(string message) =>
        message.Length > 120 ? message[..117] + "…" : message;

    private static string TrimTrayText(string text) =>
        text.Length > 63 ? text[..60] + "…" : text;

    // ----- Tray icon drawing --------------------------------------------

    private static Icon CreateTrayIcon()
    {
        using var bitmap = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var brush = new SolidBrush(Color.White);
            g.FillPolygon(brush, new[]
            {
                new Point(3, 12), new Point(10, 12), new Point(17, 5),
                new Point(17, 27), new Point(10, 20), new Point(3, 20),
            });
            using var pen = new Pen(Color.White, 3f);
            g.DrawArc(pen, 16, 9, 10, 14, -55, 110);
            g.DrawArc(pen, 19, 5, 15, 22, -55, 110);
        }
        return Icon.FromHandle(bitmap.GetHicon());
    }

    // ----- Device hot-plug notifications --------------------------------

    private sealed class NotificationClient : IMMNotificationClient
    {
        private readonly MainForm form;

        public NotificationClient(MainForm form) => this.form = form;

        public void OnDeviceStateChanged(string deviceId, DeviceState newState) => form.OnDevicesChangedFromCallback();

        public void OnDeviceAdded(string pwstrDeviceId) => form.OnDevicesChangedFromCallback();

        public void OnDeviceRemoved(string deviceId) => form.OnDevicesChangedFromCallback();

        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
        {
            if (flow == DataFlow.Render) form.OnDevicesChangedFromCallback();
        }

        public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key)
        {
        }
    }
}

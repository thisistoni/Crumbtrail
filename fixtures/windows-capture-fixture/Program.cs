using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Crumbtrail.CaptureFixture;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new CaptureFixtureForm());
    }
}

internal sealed class CaptureFixtureForm : Form
{
    private readonly Label _status = new()
    {
        AutoSize = true,
        Text = "Ready",
        AccessibleName = "Current status"
    };

    internal CaptureFixtureForm()
    {
        Text = "Crumbtrail Capture Fixture";
        AccessibleName = "Crumbtrail Capture Fixture";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(720, 540);
        ClientSize = new Size(880, 620);

        var menu = new MenuStrip();
        var file = new ToolStripMenuItem("File");
        file.DropDownItems.Add("New", null, (_, _) => SetStatus("New selected"));
        file.DropDownItems.Add("Export", null, (_, _) => SetStatus("Export selected"));
        file.DropDownItems.Add(new ToolStripSeparator());
        file.DropDownItems.Add("Exit", null, (_, _) => Close());
        var actions = new ToolStripMenuItem("Actions");
        actions.DropDownItems.Add("Run validation", null, (_, _) => SetStatus("Validation complete"));
        actions.DropDownItems.Add("Show transient notice", null, (_, _) => ShowTransientNotice());
        menu.Items.AddRange([file, actions]);
        MainMenuStrip = menu;

        var header = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI", 18, FontStyle.Bold),
            Text = "Account settings",
            Margin = new Padding(0, 0, 0, 20)
        };

        var name = Field("Name", "Ada Lovelace", false, "Name input");
        var email = Field("Email", "ada@example.test", false, "Email input");
        var password = Field("Password", "not-persisted", true, "Password input");

        var modeLabel = new Label { AutoSize = true, Text = "Theme", Anchor = AnchorStyles.Left };
        var mode = new ComboBox
        {
            DropDownStyle = ComboBoxStyle.DropDownList,
            AccessibleName = "Theme",
            Dock = DockStyle.Fill
        };
        mode.Items.AddRange(["System", "Light", "Dark"]);
        mode.SelectedIndex = 0;

        var remember = new CheckBox
        {
            AutoSize = true,
            Text = "Remember this device",
            AccessibleName = "Remember this device",
            Checked = true
        };

        var save = new Button
        {
            AutoSize = true,
            Text = "Save",
            AccessibleName = "Save settings"
        };
        save.Click += (_, _) => SetStatus("Settings saved");

        var showDialog = new Button
        {
            AutoSize = true,
            Text = "Open confirmation",
            AccessibleName = "Open confirmation dialog"
        };
        showDialog.Click += (_, _) => MessageBox.Show(
            this,
            "The fixture dialog is ready for capture.",
            "Confirm action",
            MessageBoxButtons.OKCancel,
            MessageBoxIcon.Information);

        var buttons = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            Dock = DockStyle.Fill
        };
        buttons.Controls.Add(save);
        buttons.Controls.Add(showDialog);

        var form = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 2,
            Dock = DockStyle.Top,
            Padding = new Padding(28),
        };
        form.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
        form.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        form.Controls.Add(header, 0, 0);
        form.SetColumnSpan(header, 2);
        AddRow(form, name.Label, name.Input);
        AddRow(form, email.Label, email.Input);
        AddRow(form, password.Label, password.Input);
        AddRow(form, modeLabel, mode);
        form.Controls.Add(remember, 1, form.RowCount);
        form.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        form.RowCount++;
        AddRow(form, new Label(), buttons);
        AddRow(form, new Label(), _status);

        var list = new ListView
        {
            Dock = DockStyle.Fill,
            View = View.Details,
            FullRowSelect = true,
            AccessibleName = "Recent activity"
        };
        list.Columns.Add("Action", 220);
        list.Columns.Add("State", 120);
        list.Items.Add(new ListViewItem(["Profile created", "Complete"]));
        list.Items.Add(new ListViewItem(["Email verified", "Pending"]));
        var context = new ContextMenuStrip();
        context.Items.Add("Mark complete", null, (_, _) => SetStatus("Activity completed"));
        context.Items.Add("Remove", null, (_, _) => SetStatus("Activity removed"));
        list.ContextMenuStrip = context;

        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            Orientation = Orientation.Horizontal,
            SplitterDistance = 390,
            Panel1MinSize = 260,
            Panel2MinSize = 100
        };
        split.Panel1.Controls.Add(form);
        split.Panel2.Padding = new Padding(28, 8, 28, 24);
        split.Panel2.Controls.Add(list);

        Controls.Add(split);
        Controls.Add(menu);
    }

    private static (Label Label, TextBox Input) Field(string label, string value, bool password, string accessibleName)
    {
        var caption = new Label { AutoSize = true, Text = label, Anchor = AnchorStyles.Left };
        var input = new TextBox
        {
            Text = value,
            UseSystemPasswordChar = password,
            AccessibleName = accessibleName,
            Dock = DockStyle.Fill
        };
        return (caption, input);
    }

    private static void AddRow(TableLayoutPanel panel, Control label, Control value)
    {
        var row = panel.RowCount;
        panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        label.Margin = new Padding(0, 8, 12, 8);
        value.Margin = new Padding(0, 6, 0, 6);
        panel.Controls.Add(label, 0, row);
        panel.Controls.Add(value, 1, row);
    }

    private void SetStatus(string value) => _status.Text = value;

    private async void ShowTransientNotice()
    {
        _status.Text = "Transient notice visible";
        await Task.Delay(1200);
        if (!IsDisposed)
        {
            _status.Text = "Ready";
        }
    }
}

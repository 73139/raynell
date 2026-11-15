# Tarkov Field Guide - MANUAL MAP OVERLAY
# Isolated Windows Forms utility. No EFT file, process, memory, logs, screenshots,
# keyboard hooks, networking or automation APIs are accessed.
# Requires Windows PowerShell 5.1, .NET Framework and local packaged PNGs.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

try {
    $root = Split-Path -Parent $MyInvocation.MyCommand.Path
    $manifestPath = Join-Path $root 'maps.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.mode -ne 'manual-only') { throw 'Expected a manual-only map bundle.' }
    $script:maps = @($manifest.maps)
    if ($script:maps.Count -eq 0) { throw 'No bundled map images found.' }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Tarkov Field Guide - Manual Map Overlay'
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::SizableToolWindow
    $form.StartPosition = 'Manual'
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $form.Location = [System.Drawing.Point]::new([Math]::Max(0, $screen.Right - 480), $screen.Top + 30)
    $form.Size = New-Object System.Drawing.Size(440, 555)
    $form.MinimumSize = New-Object System.Drawing.Size(300, 350)
    $form.BackColor = [System.Drawing.Color]::FromArgb(20,28,24)
    $form.ForeColor = [System.Drawing.Color]::FromArgb(230,235,220)
    $form.TopMost = $true
    $form.Opacity = 0.90

    $font = [System.Drawing.Font]::new('Malgun Gothic', 9)
    $header = New-Object System.Windows.Forms.Label
    $header.Text = 'FIELD GUIDE  |  MANUAL MAP'
    $header.Font = [System.Drawing.Font]::new('Malgun Gothic', 10, [System.Drawing.FontStyle]::Bold)
    $header.ForeColor = [System.Drawing.Color]::FromArgb(190,211,163)
    $header.Location = [System.Drawing.Point]::new(12,10)
    $header.AutoSize = $true
    $form.Controls.Add($header)

    $mapLabel = New-Object System.Windows.Forms.Label
    $mapLabel.Text = '지도 직접 선택'
    $mapLabel.Location = [System.Drawing.Point]::new(12,41)
    $mapLabel.Size = [System.Drawing.Size]::new(95,23)
    $form.Controls.Add($mapLabel)

    $script:mapBox = New-Object System.Windows.Forms.ComboBox
    $script:mapBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
    $script:mapBox.Location = [System.Drawing.Point]::new(110,38)
    $script:mapBox.Width = 290
    $script:mapBox.Anchor = 'Top,Left,Right'
    $script:mapBox.Font = $font
    foreach ($m in $script:maps) { [void]$script:mapBox.Items.Add($m.name) }
    $form.Controls.Add($script:mapBox)

    $floorLabel = New-Object System.Windows.Forms.Label
    $floorLabel.Text = '층 직접 선택'
    $floorLabel.Location = [System.Drawing.Point]::new(12,75)
    $floorLabel.Size = [System.Drawing.Size]::new(95,23)
    $form.Controls.Add($floorLabel)

    $script:floorBox = New-Object System.Windows.Forms.ComboBox
    $script:floorBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
    $script:floorBox.Location = [System.Drawing.Point]::new(110,72)
    $script:floorBox.Width = 290
    $script:floorBox.Anchor = 'Top,Left,Right'
    $script:floorBox.Font = $font
    $form.Controls.Add($script:floorBox)

    $imagePanel = New-Object System.Windows.Forms.Panel
    $imagePanel.Location = [System.Drawing.Point]::new(12,112)
    $imagePanel.Size = [System.Drawing.Size]::new(400,340)
    $imagePanel.Anchor = 'Top,Bottom,Left,Right'
    $imagePanel.BackColor = [System.Drawing.Color]::FromArgb(12,16,14)
    $form.Controls.Add($imagePanel)

    $script:mapImage = New-Object System.Windows.Forms.PictureBox
    $script:mapImage.Dock = 'Fill'
    $script:mapImage.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
    $imagePanel.Controls.Add($script:mapImage)

    $opacityLabel = New-Object System.Windows.Forms.Label
    $opacityLabel.Text = '투명도'
    $opacityLabel.Location = [System.Drawing.Point]::new(12,462)
    $opacityLabel.Anchor = 'Bottom,Left'
    $opacityLabel.AutoSize = $true
    $form.Controls.Add($opacityLabel)

    $opacityBar = New-Object System.Windows.Forms.TrackBar
    $opacityBar.Minimum = 40
    $opacityBar.Maximum = 100
    $opacityBar.Value = 90
    $opacityBar.TickFrequency = 10
    $opacityBar.Location = [System.Drawing.Point]::new(67,459)
    $opacityBar.Size = [System.Drawing.Size]::new(186,42)
    $opacityBar.Anchor = 'Bottom,Left'
    $opacityBar.Add_ValueChanged({ $form.Opacity = [double]$opacityBar.Value / 100.0 })
    $form.Controls.Add($opacityBar)

    $topCheck = New-Object System.Windows.Forms.CheckBox
    $topCheck.Text = '항상 위'
    $topCheck.Checked = $true
    $topCheck.Location = [System.Drawing.Point]::new(280,464)
    $topCheck.Anchor = 'Bottom,Right'
    $topCheck.Size = [System.Drawing.Size]::new(108,28)
    $topCheck.Add_CheckedChanged({ $form.TopMost = $topCheck.Checked })
    $form.Controls.Add($topCheck)

    $status = New-Object System.Windows.Forms.Label
    $status.Text = '수동 지도만 표시 · 게임 연결 및 자동 추적 없음'
    $status.ForeColor = [System.Drawing.Color]::FromArgb(178,189,166)
    $status.Location = [System.Drawing.Point]::new(12,496)
    $status.Size = [System.Drawing.Size]::new(404,26)
    $status.Anchor = 'Bottom,Left,Right'
    $form.Controls.Add($status)

    function Show-MapImage {
        $mIndex = $script:mapBox.SelectedIndex
        $fIndex = $script:floorBox.SelectedIndex
        if ($mIndex -lt 0 -or $fIndex -lt 0) { return }
        $floor = @($script:maps[$mIndex].floors)[$fIndex]
        $relative = [string]$floor.file
        if ($relative -notmatch '^assets/[a-z0-9-]+/[0-9]+[.]png$') {
            throw 'Invalid bundled image path.'
        }
        $fullPath = Join-Path $root ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
        $bytes = [IO.File]::ReadAllBytes($fullPath)
        $stream = New-Object System.IO.MemoryStream(,$bytes)
        try {
            $original = [System.Drawing.Image]::FromStream($stream)
            try { $newImage = [System.Drawing.Bitmap]::new($original) }
            finally { $original.Dispose() }
        }
        finally { $stream.Dispose() }
        $oldImage = $script:mapImage.Image
        $script:mapImage.Image = $newImage
        if ($null -ne $oldImage) { $oldImage.Dispose() }
        $status.Text = 'MANUAL ONLY | ' + $script:maps[$mIndex].name + ' | ' + $floor.name
    }

    $script:mapBox.Add_SelectedIndexChanged({
        $script:floorBox.Items.Clear()
        $mIndex = $script:mapBox.SelectedIndex
        if ($mIndex -lt 0) { return }
        foreach ($f in @($script:maps[$mIndex].floors)) {
            [void]$script:floorBox.Items.Add($f.name)
        }
        if ($script:floorBox.Items.Count -gt 0) { $script:floorBox.SelectedIndex = 0 }
    })
    $script:floorBox.Add_SelectedIndexChanged({
        try { Show-MapImage }
        catch {
            $status.Text = '지도를 표시할 수 없습니다: ' + $_.Exception.Message
            $status.ForeColor = [System.Drawing.Color]::Orange
        }
    })
    $form.Add_Shown({ $script:mapBox.SelectedIndex = 0 })
    $form.Add_FormClosed({
        if ($null -ne $script:mapImage.Image) {
            $script:mapImage.Image.Dispose()
            $script:mapImage.Image = $null
        }
        $font.Dispose()
    })
    [void][System.Windows.Forms.Application]::Run($form)
}
catch {
    [System.Windows.Forms.MessageBox]::Show(
      ('수동 오버레이 실행 실패: ' + $_.Exception.Message),
      'Tarkov Field Guide Manual Overlay',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}

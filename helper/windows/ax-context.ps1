# ax-context.ps1: print JSON describing the focused text control (UI Automation).
# Mirrors the macOS helper: TextPattern first, then ValuePattern, then nothing.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$result = @{ helper = $true }
try {
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -ne $el) {
    $result.windowTitle = $el.Current.Name
    $result.role = $el.Current.ControlType.ProgrammaticName
    $pid = $el.Current.ProcessId
    try {
      $proc = Get-Process -Id $pid -ErrorAction Stop
      $result.appName = $proc.ProcessName
      $result.bundleId = $proc.Path
      if ($proc.MainWindowTitle) { $result.windowTitle = $proc.MainWindowTitle }
    } catch {}

    $textPattern = $null
    try { $textPattern = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern) } catch {}
    if ($null -ne $textPattern) {
      $result.isEditable = $true
      $doc = $textPattern.DocumentRange
      $full = $doc.GetText(8000)
      $sel = $textPattern.GetSelection()
      if ($sel.Length -gt 0) {
        $before = $doc.Clone(); $before.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $sel[0], [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
        $after = $doc.Clone(); $after.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, $sel[0], [System.Windows.Automation.Text.TextPatternRangeEndpoint]::End)
        $result.beforeText = $before.GetText(2000)
        $result.selectedText = $sel[0].GetText(2000)
        $result.afterText = $after.GetText(2000)
      } else {
        $result.beforeText = $full
        $result.afterText = ''
      }
    } else {
      $valuePattern = $null
      try { $valuePattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
      if ($null -ne $valuePattern) {
        $result.isEditable = -not $valuePattern.Current.IsReadOnly
        $result.beforeText = $valuePattern.Current.Value
        $result.afterText = ''
      } else {
        $result.isEditable = $false
      }
    }
  }
} catch {
  $result.error = $_.Exception.Message
}
$result | ConvertTo-Json -Compress -Depth 3

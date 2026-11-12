param(
    [string]$OutputPath = '.trellis/.runtime/avatar-lab-speech-20260908/system-voice.wav'
)

# Local native-playback fixture only: the Windows voice is not a Fish or character-voice acceptance result.
Add-Type -AssemblyName System.Speech
$fixturePath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($fixturePath)) | Out-Null
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $synth.SelectVoice('Microsoft Zira Desktop')
    $synth.Rate = 0
    $synth.SetOutputToWaveFile($fixturePath)
    $prompt = [System.Speech.Synthesis.PromptBuilder]::new()
    $prompt.AppendBreak([TimeSpan]::FromMilliseconds(700))
    $prompt.AppendText('This is a native speech playback test.')
    $prompt.AppendBreak([TimeSpan]::FromMilliseconds(900))
    $prompt.AppendText('The voice pauses, then the character speaks again.')
    $prompt.AppendBreak([TimeSpan]::FromMilliseconds(800))
    $synth.Speak($prompt)
    $synth.SetOutputToNull()
    [pscustomobject]@{ Path = $fixturePath; Bytes = (Get-Item -LiteralPath $fixturePath).Length; Voice = $synth.Voice.Name; Provider = 'Windows SAPI local fixture' } | ConvertTo-Json
} finally {
    $synth.Dispose()
}

Option Explicit
Dim WshShell, fso, appDir, exePath
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = appDir & "\MusicStudio.exe"
WshShell.CurrentDirectory = appDir
If fso.FileExists(exePath) Then
    WshShell.Run Chr(34) & exePath & Chr(34), 0, False
Else
    WshShell.Run Chr(34) & appDir & "\MusicStudio.bat" & Chr(34), 0, False
End If

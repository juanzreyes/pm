' Doble clic para abrir a tu pollito PM sin ventana de consola.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Primero instala las dependencias: abre una terminal en esta carpeta y ejecuta 'npm install'.", 48, "PM"
Else
  CreateObject("WScript.Shell").Run """" & exe & """ """ & dir & """", 0, False
End If

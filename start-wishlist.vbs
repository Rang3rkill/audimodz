Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd /c venv\Scripts\python.exe app.py", 0, False
WScript.Sleep 2000
WshShell.Run "chrome http://localhost:5000", 1, False

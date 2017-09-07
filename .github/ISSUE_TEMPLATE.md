### VRouter 版本

### 操作系统版本

### VRouter 应用内, "系统"标签页的信息

### 暂停 VRouter 后, 以下各命令的执行结果
- `nslookup qq.com` (macOS && Windows)
- `traceroute 114.114.114.114` (macOS)
- `tracert 114.114.114.114` (Windows)

### 启用 VRouter 后, 以下各命令的执行结果
- `nslookup qq.com` (macOS && Windows)
- `traceroute 114.114.114.114` (macOS)
- `tracert 114.114.114.114` (Windows)

### 日志文件的内容是什么?
- `tail -n 50 ~/Library/Application\ Support/vrouter/vrouter.log`(macOS)
- `Get-Content ~/AppData/Roaming/vrouter/vrouter.log  -tail 50 -Encoding UTF8`(Windows Powershell)

### VRouter 版本

### 操作系统版本

### VRouter 应用内, "系统"标签页的信息

### 暂停 VRouter 后, 以下命令的执行结果
- macOS: nslookup qq.com;/sbin/route -n get default;tail -n 50 ~/Library/Application\ Support/vrouter/vrouter.log
- Windows ( 请用 PowerShell 执行 ): nslookup qq.com;tracert -d -w 1000 -h 5 qq.com;Get-Content ~/AppData/Roaming/vrouter/vrouter.log  -tail 50 -Encoding UTF8

### 启用 VRouter 后, 以下命令的执行结果
- macOS: nslookup qq.com;/sbin/route -n get default;tail -n 50 ~/Library/Application\ Support/vrouter/vrouter.log
- Windows ( 请用 PowerShell 执行 ): nslookup qq.com;tracert -d -w 1000 -h 5 qq.com;Get-Content ~/AppData/Roaming/vrouter/vrouter.log  -tail 50 -Encoding UTF8

<div style="text-align:center;background-color:#6bae7f">
<img src="./img/vrouter.png" alt="vrouter" height="200px" style="padding:0">
</div>

### VRouter

一个基于 Virtualbox 和 openwrt 构建的项目, 旨在实现 OSX (MacOS) 平台上的透明代理.

VRouter 在后台运行一个 openwrt 的虚拟机, 通过更改系统的默认路由, 将所有系统数据包转发到虚拟机上. 依托 openwrt 的 iptables 进行数据包的处理.

### 如何使用

0. 确保上游路由器开启了DHCP
1. 下载运行, 填写相应的代理参数
2. 点击"切换"按钮, 切换网关为 VRouter

### FAQ

#### 为什么不直接用 shadowsocks 客户端?

使用客户端很方便, 但是仍然有以下的不足

- 每个需要代理的软件都要逐一设置.
- 命令行软件虽然可以用 `export http_proxy` 的方式使用代理, 但有时并不管用. 需要进一步折腾 Proxifier 或者 Privoxy
- 有些软件并不支持设置代理, 如系统自带的 Mail APP.

#### 好吧, 那为什么不在路由器上设置代理?

在路由器设置代理解决了客户端的不足, 但是也有局限性.

- 如果路由器性能不足, 使用 kcptun 等软件时, 负载会非常高. 而且速度比在桌面端运行 kcptun 慢很多.
- 路由器只能在固定地点使用, 便携性差.

#### 后台运行虚拟机, 会不会太耗能?

虽然是虚拟机, 但其实非常轻量. openwrt 官网提供的镜像不足 5MB, 转化为 virtualbox 虚拟机磁盘文件, 并在虚拟机上安装必要的软件后, 磁盘空间占用不足 30M. 全天候使用内存占用在 100MB 以内, CPU 占用率一般情况下为 5% 左右 (MacBook Pro Retina, 13-inch, Mid 2014), 开启 kcptun 看油管的 1080P 时, CPU 占用率波动性较大, 在 5%~30% 之间, 目测平均值在 15% 左右.

#### 跟 surge/Specht 对比有何优劣?

开源的 Specht 一直没有开发者签发, 所以在 OSX 上暂不能使用. VRouter对比 surge, 缺点是:

- 需要安装虚拟机
- 无法在移动端使用

优点是:

- 免费

#### 所以, VRouter 的优缺点是?

优点:

- 可以实现透明代理
- 性能比物理路由器强
- 便携性良好, 随笔记本移动
- 资源占用小
- 免费

缺点:

- 无法服务局域网内的其他设备
- 依赖较多

### TODO

- 更新gfwlist
- 系统状态栏

### 截图

![screen](./img/screenshot.jpg)
![screen2](./img/screenshot2.jpg)


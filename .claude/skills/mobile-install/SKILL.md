---
name: mobile-install
description: 把「Megrez」安装或更新到已连接的 iPhone 真机上（无线调试或数据线均可）。当用户说“安装到手机上”“装到 iPhone”“真机跑一下”“重新打包到手机”“更新手机上的 App”时使用。自动完成 Web 构建、cap sync、xcodebuild 签名打包、devicectl 安装与启动。Android 安装暂未实现。
argument-hint: "[--list] [--device 名称或UDID] [--debug] [--no-sync] [--no-launch]"
version: 1.0.0
---

<!-- @format -->

# 手机安装（iOS）

把当前工作区的 Web 产物装到真机 iPhone 上，一条命令走完，不需要打开 Xcode 界面。默认装已配对、当前可达的那台 iPhone；Release 构建；装完自动启动。

## 一键执行

```bash
bash .claude/skills/mobile-install/scripts/install-ios.sh
```

常用变体：

```bash
# 先看有哪些真机可用（含无线/有线、iOS 版本、开发者模式状态）
bash .claude/skills/mobile-install/scripts/install-ios.sh --list

# 多台设备时指定目标（设备名或 UDID 前缀均可，大小写不敏感）
bash .claude/skills/mobile-install/scripts/install-ios.sh --device "Hello"

# 只要编译安装、不重新构建 Web（前端没改时更快）
bash .claude/skills/mobile-install/scripts/install-ios.sh --no-sync

# 装 Debug 包；或装完不自动打开
bash .claude/skills/mobile-install/scripts/install-ios.sh --debug --no-launch
```

## 脚本做了什么

1. 用 `xcrun devicectl list devices --json-output` 发现真机（只取 `reality=physical`，模拟器不参与），按需匹配设备。
2. `pnpm mobile:sync`：构建 `apps/web/dist/index.html` 并 `cap sync ios`（含 `pod install`）。**改了前端代码必须走这一步**，否则装上去的还是旧页面。
3. `xcodebuild -workspace apps/mobile/ios/App/App.xcworkspace -scheme App -destination id=<UDID> -allowProvisioningUpdates`，DerivedData 默认放在 `~/Library/Developer/Xcode/DerivedData/MegrezApp`（**不要**放进 `ios/App/` 内，否则 `pod install` 的 clean 会失败），产物在其中的 `Build/Products/<配置>-iphoneos/App.app`，编译日志为 `xcodebuild.log`。
4. `xcrun devicectl device install app` 安装，随后用 `devicectl device process launch` 启动（bundle id 从产物的 `Info.plist` 读取，不写死）。

命令行等价于：

```bash
pnpm mobile:sync
xcodebuild -workspace apps/mobile/ios/App/App.xcworkspace -scheme App \
  -configuration Release -destination 'id=<UDID>' \
  -derivedDataPath apps/mobile/ios/App/build -allowProvisioningUpdates build
xcrun devicectl device install app --device <UDID> <App.app>
xcrun devicectl device process launch --device <UDID> <bundle-id>
```

## 前提

- Xcode 已安装且 `xcode-select` 指向完整版（`xcodebuild -version` 可用）；`jq` 可用。
- 原生工程已存在：`apps/mobile/ios/`（首次见 `README.md` 的 `cap add ios`；该目录被 gitignore，不属于仓库）。
- 签名：`project.pbxproj` 里已配置 `DEVELOPMENT_TEAM`，脚本用 `-allowProvisioningUpdates` 自动续签；换 Apple ID 或换设备后首次可能仍需要在 Xcode 里登录一次账号。
- iPhone 已解锁，且与 Mac 在**同一 Wi-Fi**（无线调试），或插着数据线。无线调试需此前在 Xcode → Window → Devices and Simulators 里为设备勾选过 Connect via network。

## 常见失败

| 现象                           | 处理                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| 列表里没有真机                 | 解锁手机；确认同一 Wi-Fi；插一次数据线重新配对；检查手机 设置 → 隐私与安全 → 开发者模式 已开启 |
| `device is locked`             | 解锁屏幕后重跑；安装与启动都要求亮屏解锁                                                       |
| 签名/描述文件报错              | 用 `pnpm mobile:ios` 打开 Xcode，在 Signing & Capabilities 里确认 Team 与 Bundle ID            |
| 装完 7 天后打不开              | 开发证书过期，重新跑本 skill                                                                   |
| 首次打开提示“不受信任的开发者” | 手机 设置 → 通用 → VPN与设备管理 里信任该证书                                                  |
| 改完前端没变化                 | 确认没加 `--no-sync`；脚本默认重新构建并同步                                                   |

## Android（后续）

当前只实现 iOS。Android 侧待补时沿用同样结构新增 `scripts/install-android.sh`：`pnpm mobile:sync` → `gradle assembleDebug` → `adb install -r app/build/outputs/apk/debug/app-debug.apk` → `adb shell am start -n <package>/<activity>`。具体命令与环境变量见 `README.md` 的「打包 Android APK」一节，不要在本 skill 里另写一份容易过期的说明。

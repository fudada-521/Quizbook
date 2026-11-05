#!/usr/bin/env bash
# 天权 · iPhone 真机安装
# 构建 Web → cap sync → xcodebuild → devicectl 安装 → 启动。
# 兼容 macOS 自带 bash 3.2（不使用 mapfile / 关联数组）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  # .claude/skills/mobile-install/scripts → 仓库根
  ROOT="$(cd "$HERE/../../../.." && pwd)"
fi

MOBILE="$ROOT/apps/mobile"
WORKSPACE="$MOBILE/ios/App/App.xcworkspace"
SCHEME="${IOS_SCHEME:-App}"
CONFIG="${IOS_CONFIGURATION:-Release}"
# DerivedData 必须放在 Xcode 工程目录之外：放在 ios/App/build 时，
# cap sync 里的 pod install 会执行 xcodebuild clean，把该目录当成“非构建系统创建”而失败。
DERIVED="${IOS_DERIVED_DATA:-$HOME/Library/Developer/Xcode/DerivedData/MegrezApp}"

DEVICE=""
DO_SYNC=1
DO_LAUNCH=1
LIST_ONLY=0

die() { printf '✗ %s\n' "$*" >&2; exit 1; }
note() { printf '▸ %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }

usage() {
  cat <<'EOF'
用法: install-ios.sh [选项]

  --list, -l          只列出已配对/可用的 iPhone 真机
  --device, -d <值>   选择设备：设备名（如 Hello）或 UDID（可只给前缀）
  --debug             构建 Debug（默认 Release）
  --no-sync           跳过 pnpm mobile:sync（前端未改动时更快）
  --no-launch         安装后不自动启动
  --derived-data <路径>  指定 DerivedData（默认 ~/Library/Developer/Xcode/DerivedData/MegrezApp）
  -h, --help          显示本帮助

环境变量: IOS_SCHEME / IOS_CONFIGURATION / IOS_DERIVED_DATA
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list|-l) LIST_ONLY=1; shift ;;
    --device|-d)
      [[ $# -ge 2 && -n "${2:-}" ]] || die "--device 需要一个设备名或 UDID"
      DEVICE="$2"; shift 2 ;;
    --debug) CONFIG="Debug"; shift ;;
    --no-sync) DO_SYNC=0; shift ;;
    --no-launch) DO_LAUNCH=0; shift ;;
    --derived-data)
      [[ $# -ge 2 && -n "${2:-}" ]] || die "--derived-data 需要一个路径"
      DERIVED="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "未知参数：$1" ;;
  esac
done

command -v xcrun >/dev/null 2>&1 || die "未找到 xcrun：请安装 Xcode 命令行工具"
command -v xcodebuild >/dev/null 2>&1 || die "未找到 xcodebuild：请安装完整版 Xcode"
command -v jq >/dev/null 2>&1 || die "未找到 jq：brew install jq"
[[ -d "$WORKSPACE" ]] || die "iOS 原生工程不存在：$WORKSPACE
  首次使用请在 apps/mobile 下执行 pnpm exec cap add ios（见 README.md）"

JSON="$(mktemp -t megrez-ios-devices).json"
trap 'rm -f "$JSON"' EXIT
if ! xcrun devicectl list devices --json-output "$JSON" >/dev/null 2>&1; then
  die "devicectl 列设备失败，请确认 Xcode 可用（pnpm mobile:ios 可打开图形界面排查）"
fi

# udid \t 名称 \t 机型 \t iOS \t 传输方式 \t 开发者模式
DEVICES_TSV="$(jq -r '
  .result.devices[]
  | select(.hardwareProperties.reality == "physical")
  | [
      .hardwareProperties.udid,
      (.deviceProperties.name // "未命名"),
      (.hardwareProperties.marketingName // "iPhone"),
      (.deviceProperties.osVersionNumber // "?"),
      (.connectionProperties.transportType // "?"),
      (.deviceProperties.developerModeStatus // "?")
    ]
  | @tsv' "$JSON")"

count_devices() {
  if [[ -z "$DEVICES_TSV" ]]; then printf '0'; else printf '%s\n' "$DEVICES_TSV" | grep -c . ; fi
}
COUNT="$(count_devices)"

print_devices() {
  printf '%-38s  %-10s  %-14s  %-6s  %-12s  %s\n' "UDID" "名称" "机型" "iOS" "传输" "开发者模式"
  printf '%-38s  %-10s  %-14s  %-6s  %-12s  %s\n' "----" "----" "----" "---" "----" "----------"
  while IFS=$'\t' read -r udid name model osv transport devmode; do
    [[ -z "$udid" ]] && continue
    printf '%-38s  %-10s  %-14s  %-6s  %-12s  %s\n' "$udid" "$name" "$model" "$osv" "$transport" "$devmode"
  done <<< "$DEVICES_TSV"
}

if [[ "$LIST_ONLY" -eq 1 ]]; then
  if [[ "$COUNT" -eq 0 ]]; then
    printf '没有发现 iPhone 真机。\n'
    printf '请解锁手机、确认与 Mac 在同一 Wi-Fi（或插数据线），再检查 设置 → 隐私与安全 → 开发者模式。\n'
    exit 0
  fi
  print_devices
  exit 0
fi

[[ "$COUNT" -gt 0 ]] || die "没有发现 iPhone 真机。请解锁手机、确认与 Mac 在同一 Wi-Fi（或插数据线），
  并检查 设置 → 隐私与安全 → 开发者模式 是否开启。"

UDID=""
DNAME=""
MATCHES=0
if [[ -n "$DEVICE" ]]; then
  NEEDLE="$(printf '%s' "$DEVICE" | tr '[:upper:]' '[:lower:]')"
  while IFS=$'\t' read -r udid name model osv transport devmode; do
    [[ -z "$udid" ]] && continue
    LUDID="$(printf '%s' "$udid" | tr '[:upper:]' '[:lower:]')"
    LNAME="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
    if [[ "$LUDID" == "$NEEDLE"* || "$LNAME" == "$NEEDLE" ]]; then
      MATCHES=$((MATCHES + 1))
      UDID="$udid"
      DNAME="$name"
    fi
  done <<< "$DEVICES_TSV"
  if [[ "$MATCHES" -eq 0 ]]; then
    print_devices >&2
    die "没有找到匹配「${DEVICE}」的 iPhone，请从上表选择"
  fi
  [[ "$MATCHES" -eq 1 ]] || die "「${DEVICE}」匹配到 $MATCHES 台设备，请给出更完整的名称或 UDID"
else
  if [[ "$COUNT" -gt 1 ]]; then
    print_devices >&2
    die "发现 $COUNT 台 iPhone，请用 --device 指定其中一台"
  fi
  IFS=$'\t' read -r UDID DNAME _ _ _ _ <<< "$DEVICES_TSV"
fi

ok "目标设备：${DNAME}（${UDID}）"

if [[ "$DO_SYNC" -eq 1 ]]; then
  command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm"
  note "构建 Web 并同步到 iOS 工程（pnpm mobile:sync）……"
  ( cd "$ROOT" && pnpm mobile:sync )
  ok "Web 构建与 cap sync 完成"
else
  note "已跳过 pnpm mobile:sync（--no-sync）"
fi

mkdir -p "$DERIVED"
LOG="$DERIVED/xcodebuild.log"
note "编译 $CONFIG 包……（日志：${LOG}）"
if ! xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "id=$UDID" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  build >"$LOG" 2>&1; then
  printf '\n----- xcodebuild 日志末尾 -----\n' >&2
  tail -n 40 "$LOG" >&2 || true
  printf '\n' >&2
  if grep -qiE 'requires a development team|no signing certificate|failed to register bundle identifier|provisioning profile' "$LOG"; then
    die "签名失败：请用 pnpm mobile:ios 打开 Xcode，在 Signing & Capabilities 里确认 Team 与 Bundle ID 后重试"
  fi
  if grep -qiE 'device is locked|DeviceLocked|not paired' "$LOG"; then
    die "设备不可用：请解锁 iPhone，确认与 Mac 同一 Wi-Fi 后重试"
  fi
  die "编译失败，详见 $LOG"
fi
ok "编译完成"

APP="$DERIVED/Build/Products/$CONFIG-iphoneos/App.app"
[[ -d "$APP" ]] || die "未找到产物：$APP"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" 2>/dev/null || true)"
[[ -n "$BUNDLE_ID" ]] || die "无法从 Info.plist 读取 Bundle ID"
ok "产物：${APP}（${BUNDLE_ID}）"

note "安装到 ${DNAME}……"
if ! xcrun devicectl device install app --device "$UDID" "$APP"; then
  die "安装失败：请解锁手机后重试；若提示连接问题，插一次数据线重新配对"
fi
ok "安装完成"

if [[ "$DO_LAUNCH" -eq 0 ]]; then
  exit 0
fi

note "启动「天权」……"
if xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" >/dev/null 2>&1; then
  ok "已在 $DNAME 上打开"
else
  printf '! 安装成功，但自动启动失败（通常是手机锁屏）。解锁后手动点开「天权」即可。\n' >&2
fi
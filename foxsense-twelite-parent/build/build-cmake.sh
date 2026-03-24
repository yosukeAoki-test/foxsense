#!/bin/bash
# FoxSenseParent ビルドスクリプト
# TWELITE DIP BLUE向けにビルドする

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# MWSDK_ROOT を自動検出 (プロジェクトの2階層上の親を探す)
FOXSENSE_ROOT="$(dirname "$PROJECT_ROOT")"
MWSDK_CANDIDATE="$FOXSENSE_ROOT/MWSTAGE202508_macOS_R2/MWSDK"

if [ -d "$MWSDK_CANDIDATE/TWENET" ]; then
    export MWSDK_ROOT="$MWSDK_CANDIDATE"
    echo "MWSDK_ROOT=$MWSDK_ROOT"
else
    if [ -z "$MWSDK_ROOT" ] || [ ! -d "$MWSDK_ROOT/TWENET" ]; then
        echo "ERROR: MWSDK_ROOT が見つかりません。"
        echo "  試みたパス: $MWSDK_CANDIDATE"
        echo "  手動で export MWSDK_ROOT=/path/to/MWSDK を実行してください。"
        exit 1
    fi
fi

TWELITE="${1:-BLUE}"  # デフォルト BLUE (TWELITE DIPはBLUE)
BUILD_DIR="$SCRIPT_DIR/objs_${TWELITE}"

echo "=== FoxSenseParent ビルド ==="
echo "  TWELITE: $TWELITE"
echo "  Build dir: $BUILD_DIR"
echo ""

if [ ! -d "$BUILD_DIR" ]; then
    cmake -G Ninja \
          -DTWELITE="$TWELITE" \
          -DCMAKE_BUILD_TYPE=MinSizeRel \
          -B "$BUILD_DIR" \
          -S "$PROJECT_ROOT"
fi

ninja -C "$BUILD_DIR"
STATUS=$?

if [ $STATUS -eq 0 ]; then
    echo ""
    echo "=== ビルド成功 ==="
    ls -la "$BUILD_DIR"/FoxSenseParent_*.bin 2>/dev/null || true
fi

exit $STATUS

##############################################################################
# FoxSenseParent - TWELITE DIP MWX親機アプリ
# CMake build configuration
#
# ビルド方法:
#   cd foxsense-twelite-parent/build
#   ./build-cmake.sh
#
# または手動:
#   export MWSDK_ROOT=/path/to/MWSTAGE202508_macOS_R2/MWSDK
#   cmake -G Ninja -B objs_BLUE -DTWELITE=BLUE -DCMAKE_BUILD_TYPE=MinSizeRel ..
#   ninja -C objs_BLUE
##############################################################################

##############################################################################
# DO NOT EDIT - COMMON DEFINITIONS AND LOADING BODY RULES
cmake_minimum_required(VERSION 3.22)
set(MWS_PROJECT_ROOT ${CMAKE_CURRENT_SOURCE_DIR})
get_filename_component(MWS_PROJECT_NAME ${MWS_PROJECT_ROOT} NAME)
if((NOT $ENV{MWSDK_ROOT} STREQUAL "") AND (IS_DIRECTORY $ENV{MWSDK_ROOT}/TWENET))
    set(MWS_MWSDK $ENV{MWSDK_ROOT})
else()
    get_filename_component(MWS_RELDIR ../.. ABSOLUTE)
    if(IS_DIRECTORY "${MWS_RELDIR}/TWENET")
        set(MWS_MWSDK ${MWS_RELDIR})
    elseif(EXISTS ${MWS_RELDIR}/TWENET.cmake)
        get_filename_component(MWS_MWSDK ${MWS_RELDIR}/../.. ABSOLUTE)
    else()
        message(FATAL_ERROR "!! MWSDK_ROOT cannot be identified. Set MWSDK_ROOT env var.")
    endif()
endif()
######################################################################## END #

##############################################################################
# PROJECT DEPENDENT PART
### INCLUDE DIRS
list(APPEND MWS_INCLUDE_DIRS
        ./
        ${MWS_MWSDK}/TWENET/current/TWENETmcu
        )

### C SOURCE FILES
file(GLOB MWS_C_SOURCES
        ./*.c
        )

### C++ SOURCE FILES
file(GLOB MWS_CXX_SOURCES
        ./*.cpp
        )

### ADDITIONAL LIBRARIES TO BE LINKED
list(APPEND MWS_LIBS "") # e.g. "-lm"
list(APPEND MWS_LIB_FILES "") # e.g. "./lib/mylib.a"
##############################################################################

##############################################################################
#  DO NOT EDIT - LOAD RULES AND DEFINE PROJECT
include(${MWS_MWSDK}/TWENET/usever.cmake)
project(${MWS_PROJECT_NAME})
######################################################################## END #

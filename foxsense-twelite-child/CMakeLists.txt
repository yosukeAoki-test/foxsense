##############################################################################
# FoxSenseChild - TWELITE DIP MWX子機アプリ
# CMake build configuration
#
# ビルド方法:
#   cd foxsense-twelite-child/build
#   ./build-cmake.sh
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
list(APPEND MWS_LIBS "")
list(APPEND MWS_LIB_FILES "")
##############################################################################

##############################################################################
#  DO NOT EDIT - LOAD RULES AND DEFINE PROJECT
include(${MWS_MWSDK}/TWENET/usever.cmake)
project(${MWS_PROJECT_NAME})
######################################################################## END #

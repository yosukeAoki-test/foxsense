##############################################################################
# FoxSense Parent (TWELITE) Firmware - CMake (CLion用)
# cmake -G Ninja -B build/objs_BLUE_Ninja -DTWELITE=BLUE -DCMAKE_BUILD_TYPE=MinSizeRel
##############################################################################
cmake_minimum_required(VERSION 3.22)
set(MWS_PROJECT_ROOT ${CMAKE_CURRENT_SOURCE_DIR})
get_filename_component(MWS_PROJECT_NAME ${MWS_PROJECT_ROOT} NAME)
if((NOT $ENV{MWSDK_ROOT} STREQUAL "") AND (IS_DIRECTORY $ENV{MWSDK_ROOT}/TWENET))
    set(MWS_MWSDK $ENV{MWSDK_ROOT})
else()
    get_filename_component(MWS_RELDIR ../.. ABSOLUTE)
    if(IS_DIRECTORY "${MWS_RELDIR}/TWENET")
        set(MWS_MWSDK ${MWS_RELDIR})
    else()
        message(FATAL_ERROR "!! MWSDK_ROOT cannot be identified. Set env MWSDK_ROOT=/path/to/MWSDK")
    endif()
endif()

list(APPEND MWS_INCLUDE_DIRS ./)
file(GLOB MWS_C_SOURCES   ./*.c)
file(GLOB MWS_CXX_SOURCES ./*.cpp)
list(APPEND MWS_LIBS "")
list(APPEND MWS_LIB_FILES "")

include(${MWS_MWSDK}/TWENET/usever.cmake)
project(${MWS_PROJECT_NAME})

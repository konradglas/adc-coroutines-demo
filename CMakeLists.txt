cmake_minimum_required(VERSION 3.25)

project(adc_coroutines_demo LANGUAGES CXX)

set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(STDEXEC_AFFINE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(STDEXEC_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(STDEXEC_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(STDEXEC_AFFINE_STDEXEC_SOURCE_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/third_party/stdexec"
    CACHE PATH "" FORCE)
add_subdirectory(third_party/stdexec-affine)

add_library(demo_support src/demo_support.cpp)
target_include_directories(demo_support PUBLIC src)
target_compile_features(demo_support PUBLIC cxx_std_20)
target_link_libraries(demo_support PRIVATE stdexec_affine::affine)

function(add_demo stage)
    add_executable(${stage} src/${stage}.cpp)
    target_link_libraries(${stage} PRIVATE demo_support stdexec_affine::affine)
    target_compile_features(${stage} PRIVATE cxx_std_20)
endfunction()

add_demo(stage_00_synchronous)
add_demo(stage_01_lost_dependency)
add_demo(stage_02_callbacks_ship_it)
add_demo(stage_03_missed_callback)
add_demo(stage_04_callbacks_qa)
add_demo(stage_05_coroutine)

target_compile_features(stage_05_coroutine PRIVATE cxx_std_20)

enable_testing()
foreach(stage
        stage_00_synchronous
        stage_01_lost_dependency
        stage_02_callbacks_ship_it
        stage_03_missed_callback
        stage_04_callbacks_qa
        stage_05_coroutine)
    add_test(NAME ${stage} COMMAND ${stage})
endforeach()

set_tests_properties(
    stage_01_lost_dependency
    stage_03_missed_callback
    PROPERTIES WILL_FAIL TRUE)

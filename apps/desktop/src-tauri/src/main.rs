// 桌面端：复用 Web 前端（apps/web），Tauri 仅提供原生窗口容器。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    chappie_desktop_lib::run();
}

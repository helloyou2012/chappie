/// Chappie 桌面端入口。
///
/// 前端直接复用 apps/web（tauri.conf.json 的 devUrl/frontendDist 指向它），
/// 因此这里不注册额外命令；如需托盘/通知等原生能力，在此扩展插件。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(debug_assertions)]
            println!("Chappie desktop starting (dev mode)");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Chappie desktop");
}

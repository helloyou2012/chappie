import {
  DEFAULT_ADMIN_URL,
  DEFAULT_SERVER_URL,
  setDefaultServerUrls,
  setStorageAdapter,
} from '@chappie/shared';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

setStorageAdapter(window.localStorage);

// 服务地址是部署配置：生产构建期由 VITE_SERVER_URL / VITE_ADMIN_URL 固定，
// 未配置时回退到同源（反向代理）或本机默认端口。仅开发构建允许界面临时切换。
setDefaultServerUrls(
  import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL,
  import.meta.env.VITE_ADMIN_URL || DEFAULT_ADMIN_URL,
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

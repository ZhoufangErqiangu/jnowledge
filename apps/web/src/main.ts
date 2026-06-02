import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
// 暗色 CSS 变量（配合 <html class="dark"> 生效）
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import router from './router'
// 初始化主题（模块级副作用：读取偏好并打上 html.dark）
import './hooks/useTheme'
import './styles/main.less'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.mount('#app')

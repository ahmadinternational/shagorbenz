import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// "/admin" → "/admin.html" for `vite dev` and `vite preview` (vercel.json does the same in production).
const adminRoute = () => {
    const rewrite = (req, _res, next) => {
        if (req.url === '/admin' || req.url?.startsWith('/admin?')) req.url = req.url.replace('/admin', '/admin.html');
        next();
    };
    return {
        name: 'admin-route',
        // Braces matter: returning the connect app would make Vite treat it as a post-hook.
        configureServer(server) {
            server.middlewares.use(rewrite);
        },
        configurePreviewServer(server) {
            server.middlewares.use(rewrite);
        }
    };
};

export default defineConfig({
    plugins: [adminRoute()],
    build: {
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, 'index.html'),
                admin: resolve(import.meta.dirname, 'admin.html')
            }
        }
    }
});

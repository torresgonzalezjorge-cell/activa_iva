'use strict';

const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const LOGIN_URL = 'https://comercialactivaspa.com';
const WORDPRESS_ISSUER = 'https://comercialactivaspa.com/';
const COOKIE_NAME = 'activa_session';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

function identityError(payload, now) {
    if (!payload || typeof payload !== 'object') return 'datos de identidad ausentes';
    if (!Number.isSafeInteger(payload.user_id) || payload.user_id <= 0) return 'user_id ausente o inválido';
    if (typeof payload.email !== 'string' || payload.email.length > 190
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return 'email ausente o inválido';
    if (!Number.isSafeInteger(payload.plan_expires_at)
        || payload.plan_expires_at * 1000 > 8640000000000000) return 'vigencia del plan ausente o inválida';
    if (payload.plan_expires_at * 1000 <= now) return 'vigencia del plan vencida';
    return null;
}

function validIdentity(payload, now) {
    return identityError(payload, now) === null;
}

function jwtErrorReason(error) {
    if (error instanceof jwt.TokenExpiredError) return 'token expirado';
    if (error instanceof jwt.NotBeforeError) return 'token aún no válido';
    if (error instanceof jwt.JsonWebTokenError) {
        const reasons = {
            'invalid signature': 'firma inválida',
            'jwt must be provided': 'token ausente',
            'jwt must be a string': 'formato de token inválido',
            'jwt malformed': 'formato de token inválido',
            'invalid token': 'formato de token inválido',
            'jwt signature is required': 'firma ausente',
            'invalid algorithm': 'algoritmo no permitido',
            'invalid exp value': 'exp inválido',
            'invalid nbf value': 'nbf inválido'
        };
        return reasons[error.message] || 'token inválido';
    }
    return 'error al verificar el token';
}

function installWordPressSession(app, secret, appId) {
    if (typeof secret !== 'string' || !secret.trim()) {
        throw new Error('Falta JWT_SECRET en el entorno');
    }
    if (typeof appId !== 'string' || !/^[a-z0-9_-]+$/.test(appId)) {
        throw new Error('Falta un identificador de aplicación válido');
    }
    const audience = `activa-suite:${appId}`;

    app.use(cookieParser());

    app.get('/auth', (req, res) => {
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        let payload;
        try {
            payload = jwt.verify(req.query.token, secret, {
                algorithms: ['HS256'],
                issuer: WORDPRESS_ISSUER,
                audience
            });
        } catch (error) {
            console.error('Acceso /auth rechazado: ' + jwtErrorReason(error));
            return res.redirect(LOGIN_URL);
        }

        const now = Date.now();
        const reason = identityError(payload, now)
            || (!Number.isSafeInteger(payload.exp) ? 'exp ausente o inválido' : null)
            || (payload.aud !== audience || payload.app_id !== appId ? 'destinatario inválido' : null);
        if (reason) {
            console.error('Acceso /auth rechazado: ' + reason);
            return res.redirect(LOGIN_URL);
        }
        const session = jwt.sign({
            user_id: payload.user_id,
            email: payload.email,
            plan_expires_at: payload.plan_expires_at,
            aud: audience,
            app_id: appId,
            exp: payload.plan_expires_at,
            session: true
        }, secret, { algorithm: 'HS256', noTimestamp: true });

        res.cookie(COOKIE_NAME, session, {
            ...cookieOptions,
            maxAge: payload.plan_expires_at * 1000 - now
        });
        return res.redirect('/');
    });

    app.use((req, res, next) => {
        if (['GET', 'HEAD'].includes(req.method) && (
            req.path === '/manifest.json' || req.path === '/service-worker.js'
            || req.path === '/icons/icon-192.png' || req.path === '/icons/icon-512.png'
        )) return next();

        let payload;
        try {
            payload = jwt.verify(req.cookies[COOKIE_NAME], secret, {
                algorithms: ['HS256'],
                audience
            });
        } catch (error) {
            return unauthorized(req, res);
        }
        if (!validIdentity(payload, Date.now()) || payload.session !== true
            || payload.aud !== audience || payload.app_id !== appId
            || payload.exp !== payload.plan_expires_at) {
            return unauthorized(req, res);
        }

        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            const origin = req.get('Origin');
            let sameHost = true;
            if (origin) {
                try {
                    sameHost = new URL(origin).host === req.get('host');
                } catch (error) {
                    sameHost = false;
                }
            }
            if (req.get('Sec-Fetch-Site') === 'cross-site' || !sameHost) {
                return res.status(403).json({ error: 'Origen de solicitud no permitido' });
            }
        }

        req.sessionUser = {
            user_id: payload.user_id,
            email: payload.email,
            plan_expires_at: payload.plan_expires_at
        };
        res.set('Cache-Control', 'no-store');
        return next();
    });

    app.post('/api/auth/logout', (_req, res) => {
        res.clearCookie(COOKIE_NAME, cookieOptions);
        res.status(204).end();
    });
}

function unauthorized(req, res) {
    res.set('Cache-Control', 'no-store');
    if (req.path === '/api' || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Sesión inválida o vencida' });
    }
    return res.redirect(LOGIN_URL);
}

module.exports = { installWordPressSession };

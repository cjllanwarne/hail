(function () {
    var el = document.getElementById('quote-js');
    var basePath = (el && el.dataset.basePath) || '';
    var quoteName = (el && el.dataset.quoteName) || '';

    function apiRequest(method, url, body) {
        var opts = {method: method, headers: {'Content-Type': 'application/json'}};
        if (body !== undefined) opts.body = JSON.stringify(body);
        return fetch(basePath + url, opts).then(function (r) {
            if (!r.ok) return r.text().then(function (t) {
                var msg = t;
                try { msg = JSON.parse(t).reason || t; } catch (_) {}
                throw new Error(msg || r.statusText);
            });
            return r.json();
        });
    }

    window.quoteSavePatch = function (body, done, setError) {
        setError('');
        apiRequest('PATCH', '/api/v1alpha/quotes/' + encodeURIComponent(quoteName), body)
            .then(function () { location.reload(); })
            .catch(function (e) { setError(e.message); });
    };

    window.quoteAddManager = function (user, role, setError) {
        setError('');
        if (!user.trim()) { setError('Username is required.'); return; }
        apiRequest('POST', '/api/v1alpha/quotes/' + encodeURIComponent(quoteName) + '/managers', {user: user.trim(), role: role})
            .then(function () { location.reload(); })
            .catch(function (e) { setError(e.message); });
    };

    window.quoteRemoveManager = function (user, setError) {
        setError('');
        apiRequest('DELETE', '/api/v1alpha/quotes/' + encodeURIComponent(quoteName) + '/managers/' + encodeURIComponent(user))
            .then(function () { location.reload(); })
            .catch(function (e) { setError(e.message); });
    };
})();

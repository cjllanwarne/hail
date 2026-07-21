(function () {
    var el = document.getElementById('billing-project-js');
    var basePath = (el && el.dataset.basePath) || '';
    var bpName = (el && el.dataset.bpName) || '';

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

    // Expose savePatch to Alpine.js components via window
    window.bpSavePatch = function (body, done, setError) {
        setError('');
        apiRequest('PATCH', '/api/v1alpha/billing_projects/' + encodeURIComponent(bpName), body)
            .then(function () { location.reload(); })
            .catch(function (e) { setError(e.message); });
    };

    window.bpRemoveMember = function (user, setError) {
        setError('');
        apiRequest('POST', '/api/v1alpha/billing_projects/' + encodeURIComponent(bpName) + '/users/' + encodeURIComponent(user) + '/remove')
            .then(function () { location.reload(); })
            .catch(function (e) { setError(e.message); });
    };

    window.bpAddMember = function (user, setError) {
        setError('');
        if (!user.trim()) { setError('Username is required.'); return; }
        apiRequest('POST', '/api/v1alpha/billing_projects/' + encodeURIComponent(bpName) + '/users/' + encodeURIComponent(user.trim()) + '/add')
            .then(function () { location.reload(); })
            .catch(function (e) { setError(e.message); });
    };
})();

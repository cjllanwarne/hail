(function () {
    var el = document.getElementById('quotes-js');
    var basePath = (el && el.dataset.basePath) || '';

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

    window.createQuote = function (name, costObject, authorizedAmount, piName, pmDesignee, setError) {
        setError('');
        if (!name.trim()) { setError('Name is required.'); return; }
        if (!costObject.trim()) { setError('Cost Object is required.'); return; }
        var aa = authorizedAmount.trim() === '' ? 'unlimited' : parseFloat(authorizedAmount);
        apiRequest('POST', '/api/v1alpha/quotes/' + encodeURIComponent(name.trim()), {
            cost_object: costObject.trim(),
            authorized_amount: aa,
            pi_name: piName.trim() || null,
            pm_designee: pmDesignee.trim() || null,
        }).then(function () {
            window.location.href = basePath + '/billing/quotes/' + encodeURIComponent(name.trim());
        }).catch(function (e) {
            setError(e.message);
        });
    };
})();

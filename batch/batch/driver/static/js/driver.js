(function () {
    var enableBtn = document.getElementById('enable-react-ui-btn');
    if (enableBtn) {
        enableBtn.addEventListener('click', function (e) {
            e.preventDefault();
            document.cookie = 'hail_react_ui=1; max-age=108000; path=/; SameSite=Lax';
            location.reload();
        });
    }
})();

(function () {
  function submitDeclareFlakyAction(action) {
    var section = document.getElementById('declare-flaky-section');
    if (!section) return;

    var checkboxes = section.querySelectorAll('.flaky-job-checkbox');
    var confirm = document.getElementById('declare-flaky-confirm');
    var errorDiv = document.getElementById('declare-flaky-error');

    var allChecked = Array.prototype.every.call(checkboxes, function (cb) { return cb.checked; });
    if (!allChecked) {
      errorDiv.textContent = 'Please check every failed job before submitting.';
      errorDiv.style.display = '';
      return;
    }
    if (!confirm.checked) {
      errorDiv.textContent = 'Please check the confirmation box before submitting.';
      errorDiv.style.display = '';
      return;
    }

    var csrf = document.getElementById('declare-flaky-csrf').value;
    var url = document.getElementById('declare-flaky-url').value;

    var formData = new FormData();
    formData.append('_csrf', csrf);
    formData.append('action', action);
    formData.append('confirmed', '1');
    checkboxes.forEach(function (cb) {
      formData.append('job_id', cb.getAttribute('data-entry'));
    });

    fetch(url, { method: 'POST', body: formData })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) {
          errorDiv.textContent = data.error;
          errorDiv.style.display = '';
        } else {
          window.location.reload();
        }
      })
      .catch(function () {
        errorDiv.textContent = 'Request failed. Please try again.';
        errorDiv.style.display = '';
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btnRetry = document.getElementById('declare-flaky-btn-retry');
    var btnIgnore = document.getElementById('declare-flaky-btn-ignore');
    if (btnRetry) btnRetry.addEventListener('click', function () { submitDeclareFlakyAction('retry'); });
    if (btnIgnore) btnIgnore.addEventListener('click', function () { submitDeclareFlakyAction('ignore'); });
  });
})();

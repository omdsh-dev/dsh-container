(() => {
  const loginPath = "/_dsh-container/auth/login";
  const markerHeader = "X-DSH-Container-Auth";
  let redirecting = false;

  function redirectOnAuthenticationFailure(response) {
    if (redirecting
      || response.status !== 401
      || response.headers.get(markerHeader) !== "required"
      || window.location.pathname === loginPath) return;
    redirecting = true;
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    try {
      window.sessionStorage.setItem("dsh-container-auth-return", returnPath);
    } catch {
      // 禁用会话存储不会影响 URL 中的安全相对路径回跳。
    }
    const query = new URLSearchParams({ next: returnPath });
    window.location.replace(`${loginPath}?${query}`);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...arguments_) => {
    const response = await nativeFetch(...arguments_);
    redirectOnAuthenticationFailure(response);
    return response;
  };
})();

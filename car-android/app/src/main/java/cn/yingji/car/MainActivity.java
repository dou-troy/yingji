package cn.yingji.car;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * 映集车机版外壳。
 *
 * 设计要点：
 *  1. 界面完全内置在 assets，断网也能打开壳，不依赖线上网页；
 *  2. 数据仍走原有 Railway 后端 /api/*，后端架构一行不改；
 *  3. B站沿用网页版的内嵌播放（player.bilibili.com 官方 iframe），
 *     并接管 HTML5 视频的自定义全屏视图，保证「全屏播放」按键在车机上生效；
 *  4. 其余外链交给系统 Intent（QQ音乐 / 豆瓣 / 视频平台）；
 *  5. 只使用 Android 原生 API，无 androidx / 无第三方依赖，降低构建失败率。
 */
public class MainActivity extends Activity {

    private WebView web;
    private WebChromeClient chrome;
    private View customView;
    private FrameLayout fullscreenContainer;
    private WebChromeClient.CustomViewCallback customViewCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyImmersive();

        web = new WebView(this);
        setContentView(web);
        web.setBackgroundColor(0xFF0E1116);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true; // 车机上禁掉长按弹出菜单，避免误触
            }
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // assets 页面（file://）需要跨域请求 Railway 的 HTTPS 接口，后端已开放 CORS:*
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);          // 不跟随系统字体缩放，保证车机排版稳定
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 桌面 UA：B站官方播放器对移动 WebView 常会提示「去 App 打开」，
        // 车机是横屏大屏，走 H5 桌面版内嵌播放成功率更高
        s.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 YingjiCar/1.0");
        // 播放由用户点「内嵌播放」触发；放开手势限制，避免 iframe 内点击被老内核吞掉
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        web.addJavascriptInterface(new Bridge(), "YingjiCar");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return true;
                // B站官方播放器 iframe 的内部导航留在页面里，别把播放中误触变成跳出 App
                if (url.startsWith("file:") || isFrameNav(url)) return false;
                openExternal(url);
                return true;
            }

            @TargetApi(Build.VERSION_CODES.N)
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl() != null ? request.getUrl().toString() : "";
                if (url.startsWith("file:")) return false;
                if (!request.isForMainFrame() && isFrameNav(url)) return false;
                openExternal(url);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.startsWith("file:")) {
                    toast("界面资源加载失败，请重新安装");
                }
            }
        });
        chrome = new WebChromeClient() {
            /** HTML5 <video> / B站播放器请求全屏时，把视频视图挂到窗口上 */
            @Override
            public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
                if (customView != null) {
                    try { callback.onCustomViewHidden(); } catch (Exception ignored) {}
                    return;
                }
                customView = view;
                customViewCallback = callback;
                fullscreenContainer = new FrameLayout(MainActivity.this);
                fullscreenContainer.setBackgroundColor(0xFF000000);
                fullscreenContainer.addView(view, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                ViewGroup decor = (ViewGroup) getWindow().getDecorView();
                decor.addView(fullscreenContainer, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
                applyImmersive();
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                ViewGroup decor = (ViewGroup) getWindow().getDecorView();
                try { decor.removeView(fullscreenContainer); } catch (Exception ignored) {}
                fullscreenContainer = null;
                customView = null;
                web.setVisibility(View.VISIBLE);
                if (customViewCallback != null) {
                    try { customViewCallback.onCustomViewHidden(); } catch (Exception ignored) {}
                    customViewCallback = null;
                }
                applyImmersive();
            }
        };
        web.setWebChromeClient(chrome);
        web.loadUrl("file:///android_asset/index.html");
    }

    private void applyImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    /** 返回键先交给页面处理（关面板 / 回首页），首页再按一次才退出 */
    @Override
    public void onBackPressed() {
        // 原生视频全屏优先退出（此时 WebView 被隐藏，页面收不到返回键）
        if (customView != null && chrome != null) {
            chrome.onHideCustomView();
            return;
        }
        if (web != null) {
            web.loadUrl("javascript:(function(){if(window.__yjBack){window.__yjBack();}})()");
        }
    }

    @Override
    protected void onDestroy() {
        if (customView != null && chrome != null) chrome.onHideCustomView();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** iframe 内部导航（含 B站播放器）留在 WebView 内，不当成外链跳出 */
    private boolean isFrameNav(String url) {
        return url.startsWith("https://") || url.startsWith("http://")
                || url.equals("about:blank") || url.startsWith("about:blank#");
    }

    private void openExternal(String url) {
        if (url == null) return;
        final String u = url.trim();
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            toast("链接不可用");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            copyText(u);
            toast("未找到可打开的应用，链接已复制");
        } catch (Exception e) {
            copyText(u);
            toast("打开失败，链接已复制");
        }
    }

    private void copyText(final String text) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("yingji", text));
                } catch (Exception ignored) {
                }
            }
        });
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    /** 暴露给车机页面的原生能力 */
    private final class Bridge {
        @JavascriptInterface
        public void open(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openExternal(url);
                }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            copyText(text);
        }

        @JavascriptInterface
        public void toast(final String msg) {
            MainActivity.this.toast(msg);
        }

        /** 网页端进入/退出全屏时，重新压住车机系统栏（Activity 本身已是沉浸式全屏） */
        @JavascriptInterface
        public void fullscreen(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyImmersive();
                }
            });
        }

        @JavascriptInterface
        public void finish() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.finish();
                }
            });
        }
    }
}

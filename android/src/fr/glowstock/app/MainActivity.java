package fr.glowstock.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.*;
import android.widget.*;

public class MainActivity extends Activity {
    private WebView web;
    private PermissionRequest cameraRequest;
    private ValueCallback<Uri[]> fileCallback;
    private LinearLayout errorPanel;
    private String failedUrl = "https://glowstock.fr/";

    private boolean isGlowStock(Uri uri) {
        return "https".equals(uri.getScheme()) && "glowstock.fr".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"mailto".equals(scheme) && !"tel".equals(scheme)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (android.content.ActivityNotFoundException e) {
            Toast.makeText(this, "Aucune application pour ouvrir ce lien.", Toast.LENGTH_LONG).show();
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xfffaf9f6);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        int touchSize = Math.round(48 * getResources().getDisplayMetrics().density);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(android.view.Gravity.END | android.view.Gravity.CENTER_VERTICAL);
        TextView options = new TextView(this);
        options.setText("⋮");
        options.setTextSize(28);
        options.setTextColor(0xff333130);
        options.setGravity(android.view.Gravity.CENTER);
        options.setContentDescription("Options de l’application");
        options.setFocusable(true);
        android.util.TypedValue ripple = new android.util.TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true);
        options.setBackgroundResource(ripple.resourceId);
        options.setOnClickListener(v -> {
            PopupMenu menu = new PopupMenu(this, options);
            menu.getMenu().add(0, 0, 0, "Actualiser");
            menu.getMenu().add(0, 1, 1, "Ouvrir dans le navigateur");
            menu.setOnMenuItemClickListener(item -> {
                if (item.getItemId() == 0) { errorPanel.setVisibility(View.GONE); web.setVisibility(View.VISIBLE); web.reload(); }
                else openExternal(Uri.parse(isGlowStock(Uri.parse(web.getUrl() == null ? failedUrl : web.getUrl())) ? (web.getUrl() == null ? failedUrl : web.getUrl()) : "https://glowstock.fr/"));
                return true;
            });
            menu.show();
        });
        toolbar.addView(options, new LinearLayout.LayoutParams(touchSize, touchSize));
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, touchSize));
        getWindow().setStatusBarColor(0xfffaf9f6);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setPadding(32, 48, 32, 32);
        TextView error = new TextView(this);
        error.setText("GlowStock est momentanément inaccessible. Vérifiez votre connexion Internet puis réessayez.");
        error.setTextSize(18);
        errorPanel.addView(error);
        Button retry = new Button(this);
        retry.setText("Réessayer");
        retry.setOnClickListener(v -> web.loadUrl(failedUrl));
        errorPanel.addView(retry);
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel);
        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (isGlowStock(req.getUrl())) return false;
                if (req.isForMainFrame()) openExternal(req.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (cameraRequest != null) { cameraRequest.deny(); cameraRequest = null; }
                errorPanel.setVisibility(View.GONE);
                web.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (req.isForMainFrame()) showFailure(req.getUrl());
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse response) {
                if (req.isForMainFrame() && response.getStatusCode() >= 500) showFailure(req.getUrl());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!isGlowStock(request.getOrigin()) || !isGlowStock(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))
                    || !java.util.Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                    request.deny(); return;
                }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    if (cameraRequest != null) cameraRequest.deny();
                    cameraRequest = request;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, 10);
                }
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (cameraRequest == request) cameraRequest = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), 11); }
                catch (android.content.ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (url.startsWith("blob:")) {
                new AlertDialog.Builder(this).setMessage("Pour exporter votre inventaire, ouvrez cette page dans votre navigateur puis relancez l’export. Une connexion à votre compte peut être nécessaire.")
                    .setPositiveButton("Ouvrir", (d, w) -> openExternal(Uri.parse(web.getUrl())))
                    .setNegativeButton("Annuler", null).show();
            } else openExternal(Uri.parse(url));
        });
        if (state == null || web.restoreState(state) == null) web.loadUrl("https://glowstock.fr/");
    }

    private void showFailure(Uri url) {
        if (isGlowStock(url)) failedUrl = url.toString();
        web.setVisibility(View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 10 && cameraRequest != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) cameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else cameraRequest.deny();
            cameraRequest = null;
        }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == 11 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onSaveInstanceState(Bundle out) { web.saveState(out); super.onSaveInstanceState(out); }
    @Override protected void onPause() { web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (cameraRequest != null) cameraRequest.deny();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        web.destroy(); super.onDestroy();
    }
}

package br.cocapec.recebimento.demo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrivateAttachmentPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

# Android e iOS

Existe uma única aplicação Angular/Ionic em `frontend/`. O projeto Android Capacitor utiliza o build dessa aplicação e a mesma API Django; os dados persistem no PostgreSQL.

## Android local

O projeto fixa Gradle 8.14.3, Android Gradle Plugin 8.13 e SDK de compilação/alvo 36. Use JDK 21, plataforma Android 36, build-tools 36.0.0 e platform-tools. Referências: [Capacitor 8](https://capacitorjs.com/docs/updating/8-0) e [compatibilidade Gradle/Java](https://docs.gradle.org/current/userguide/compatibility.html).

```powershell
$env:JAVA_HOME = 'C:\caminho\jdk-21'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
java -version
adb devices
$taskAndroidSerial = 'emulator-5586' # Ajuste ao serial exibido no seu ambiente.
$env:ANDROID_SERIAL = $taskAndroidSerial
Set-Location C:\Projects\hackaton-2026\frontend
npm ci
npm run android:sync
Set-Location android
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
.\gradlew.bat connectedDebugAndroidTest
adb -s $taskAndroidSerial install -r .\app\build\outputs\apk\debug\app-debug.apk
# Após instrumentação/instalação, com a API na porta 8000:
adb -s $taskAndroidSerial reverse tcp:8000 tcp:8000
```

Use um dispositivo com depuração USB ou um emulador. `adb devices` deve mostrar `device`, sem `unauthorized`. Se o mesmo AVD aparecer por dois transportes, desconecte o transporte redundante antes da instrumentação: executar dois testes simultâneos no mesmo app causa conflito. Selecione o destinatário com `ANDROID_SERIAL` e `adb -s`. A instrumentação pode reinstalar a aplicação; reaplique `adb reverse` depois dela.

`frontend/public/runtime-config.json` define `nativeApiUrl`. O padrão `http://localhost:8000/api/v1` usa `adb reverse`. Para rede local, configure o endereço acessível ao telefone antes do build, sem credenciais. HTTP/cleartext são exclusivos da demonstração local; o app não está pronto para produção.

O token fica somente em memória. Ao encerrar o aplicativo, faça novo login. Recebimentos e boletins continuam no backend. A senha de demonstração fica no `.env` privado e não faz parte do APK. O Capacitor usa `loggingBehavior: 'none'`; anexos autorizados podem ser salvos pelo Storage Access Framework, com destino escolhido pelo usuário.

## Aceite funcional

1. Com a API ativa, instalar o APK e aplicar o encaminhamento da porta.
2. Entrar com conta sintética e abrir recebimento/boletim do mesmo backend usado na web.
3. Salvar um anexo sintético, cancelar e repetir o seletor de destino.
4. Registrar chegada enquanto as aprovações ainda estão pendentes; conferir a alteração na web.
5. Reabrir o app, entrar novamente e recuperar os registros.
6. Reiniciar API e PostgreSQL preservando o volume, reaplicar o encaminhamento se necessário, entrar e conferir recebimento/boletim e seus valores.

Em 03/10/2026, build, testes locais e instrumentação agregada passaram em AVD com SDK 36/JDK 21. O teste de instrumentação verifica contexto/aplicação. A falha anterior de classes Kotlin duplicadas no módulo de testes gerado foi corrigida. O APK atual passou em login, consulta e gravação de chegada com aprovações pendentes, refletida na web. O checkpoint criado após a gravação foi conferido após reiniciar API/PostgreSQL e permaneceu igual. SAF/anexo e recuperação visual nativa foram conferidos em rodada anterior.

A falha de conexão foi isolada desligando a API e acionando a confirmação de entrada: a tela mostrou erro de conexão, sem mensagem de sucesso e com entrada não registrada; o estado permaneceu igual ao checkpoint. A asserção Maestro do texto do alerta retornou FAIL porque a hierarquia WebView não o expôs, apesar de a inspeção visual mostrar a mensagem. Consulte o [relatório de validação](../docs/validacao.md). Nenhum aparelho físico foi validado.

## iOS — NOT RUN no Windows

Em Mac com Xcode e ferramenta Capacitor compatível, a partir de `frontend`:

```powershell
npm ci
npm install @capacitor/ios@8.5.2
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
```

Configure API HTTPS acessível e assinatura. Compile, execute em simulador/dispositivo e repita o aceite com persistência. A inclusão do pacote iOS acima altera dependências somente nessa preparação em Mac. Nenhum build ou percurso iOS foi executado no Windows; iOS permanece NOT RUN.

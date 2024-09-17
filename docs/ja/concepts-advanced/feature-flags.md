# フィーチャーフラグ

Lagoonの一部の機能は、フィーチャーフラグを設定することで制御できます。
これは、新しいプラットフォーム機能を制御された方法で展開するためのユーザーと管理者を支援するように設計されています。

## 環境変数 { #environment-variables }

以下の環境変数は、フィーチャーフラグを切り替えるために環境またはプロジェクトに設定することができます。

| 環境変数名 | アクティブスコープ | 導入されたバージョン | 削除されたバージョン | デフォルト値 | 説明 |
| --- | --- | --- | --- | --- | --- |
| `LAGOON_FEATURE_FLAG_ROOTLESS_WORKLOAD`        | `global`     | 2.2.0              | -               | `無効`    | この環境またはプロジェクトのポッドに非rootポッドセキュリティコンテキストを設定するには、`enabled`に設定します。<br><br>このフラグは最終的に廃止され、その時点で非rootワークロードが強制されます。 |
| `LAGOON_FEATURE_FLAG_ISOLATION_NETWORK_POLICY` | `global`     | 2.2.0              | -               | `無効`    | デプロイ時に各環境にデフォルトの名前空間分離ネットワークポリシーを追加するには、`enabled`に設定します。<br><br>このフラグは最終的に廃止され、その時点で名前空間分離ネットワークポリシーが強制されます。<br><br>注: この機能を有効にしてから無効にすると、既存のネットワークは削除されません。 以前のデプロイからのポリシー削除されません。これらは手動で削除する必要があります。|

## クラスターレベルのコントロール

機能フラグはクラスターレベルでも制御することができます。これに対応している[`lagoon-build-deploy`チャート](https://github.com/uselagoon/lagoon-charts/blob/main/charts/lagoon-build-deploy/values.yaml)があります。
各機能フラグには、設定できる値が`default`と`force`の2種類あります。

* `default`はクラスターにデプロイされる環境のデフォルトポリシーを制御しますが、上記の環境変数によってプロジェクトレベルまたは環境レベルで上書きすることができます。
* `force`もクラスターにデプロイされる環境のポリシーを制御しますが、上記の環境変数によって上書きすることはできません。
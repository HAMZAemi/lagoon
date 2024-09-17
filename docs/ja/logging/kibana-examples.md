# Kibanaの例

[Kibanaの入門ビデオ](https://www.elastic.co/webinars/getting-started-kibana)を見て、ログを扱う準備が整いましたか？私たちがサポートします！このページでは、使用できるKibanaクエリの例を紹介します。これはKibana 101のクラスではありませんが、Kibanaで何ができるのかを理解するのに役立ちます。

始める準備はできましたか？　では始めましょう！

!!! Note "注意:"
    開始する前にテナントを選択していることを確認してください！ 左側のメニューにある `Tenant` アイコンをクリックしてそれを行うことができます。 テナントを選択したら、再度 `Discover` アイコンをクリックして始めてください。

## ルーターログ

以下に、2つの一般的なログのリクエストの例を示します:

* あなたのサイトへのヒット/リクエストの総数を表示します。
* 特定のIPアドレスからのヒット/リクエストの数を表示します。

### サイトへのヒット/リクエストの総数

* Kibanaを起動し、`Discovery` を選択しましょう(以下のスクリーンショットの＃1)
* 次にあなたのプロジェクトのルーターログです(＃2)。
* そこから、この情報を少し絞り込みます。私たちの主な製品環境に焦点を当てましょう。
* 検索バー(＃3)に入力します:

  `openshift_project: "本番プロジェクトの名前"`

* これにより、指定された期間内の本番環境へのすべてのヒットが表示されます
* 右上隅のメニュー (#4) で期間を変更できます。
* エントリの横にある矢印をクリックすると (#5)、エントリが展開され、キャプチャされたすべての情報が表示されます
* フィールドにカーソルを合わせて左側の「追加」ボタンをクリックすると (#6)、そのフィールドをウィンドウに追加できます
* 検索バーを使用して、結果をさらに絞り込むこともできます。

![Kibanaでサイトへの総ヒット数/リクエスト数を取得する方法](../images/kibana_example1.png)

### 特定のIPアドレスからのヒット数/リクエスト数

上記のクエリを実行すると、サイトへのすべてのトラフィックの概要が表示されますが、特定のIPアドレスに絞り込みたい場合はどうでしょうか？例えば、あるIPアドレスがサイトに何回アクセスしたか、そのIPアドレスがどのページを見ていたかを確認したい場合です。この次のクエリが役立ちます。

まず、前回と同じクエリから始めますが、いくつかのフィールドを追加します。

* 最初に、以下のフィールドを追加します：`client_ip`および`http_request`
* これにより、すべてのIPアドレスとそのリクエストしたページのリストが表示されます。次は、Amazee.ioページの場合の表示内容です:

![すべてのIPアドレスとそのリクエストしたページ:]( 要求された。](../images/kibana_example2.png)

これは良さそうですが、特定のIPアドレスからのリクエストだけを表示したい場合はどうでしょうか？検索条件にアドレスを追加することでフィルタリングできます。

* 次のように追加します:`AND client_ip: "IPアドレス"`.
* これにより、その特定のIPアドレスからのヒットと、そのアドレスからリクエストされたページだけが結果に表示されます。以下はamazee.ioウェブサイトの例です:

![特定のIPアドレスからのヒット。](../images/kibana_example3.png)

## コンテナログ

コンテナログは、特定のコンテナとプロジェクトに対するすべての標準出力（`stdout`）および標準エラー（`stderr`）メッセージを表示します。次に、特定のコンテナからログを取得し、そのコンテナ内の特定のエラー番号を見つける例を示します。

### コンテナからのログ

特定のコンテナ（php、nginxなど）のログを確認したいですか？その場合はこのセクションが役立ちます！ここではNGINXログを確認する方法に焦点を当てます。

* まず、Kibanaを開き、Discoverを選択します(下のスクリーンショットの＃1)。
* 次に、プロジェクトのコンテナログを選択します(＃2)。
* 検索バー(＃3)に移動し、`kubernetes.container_name: "nginx"`と入力します。
* これにより、プロジェクトのすべてのNGINXログが表示されます。 エントリの隣の矢印をクリックする(＃4)と、そのエントリが展開され、収集したすべての情報が表示されます。
* メッセージフィールドとレベルフィールドをビューに追加しましょう。左側の「Add」をクリックすることで追加できます(＃5)。
* 画面の右上隅(＃6)で時間枠を変更することができます。以下の例では、過去4時間のログを見ています。

![](../images/kibana_example4.png)

### ログの特定のエラー

NGINXコンテナで発生した500 Internal Serverエラーの数を確認したいですか？検索クエリを変更することで確認できます。次のように検索します:

`kubernetes.container_name: "nginx" AND message: "500"`

これにより、NGINXコンテナ内の500エラーメッセージのみが表示されます。任意のコンテナ内の任意のエラーメッセージを検索することができます。

## 可視化

Kibanaでは、可視化やグラフを作成するオプションも提供されています。ここでは、上記のクエリを使用して、月間のヒット/リクエスト数を表示するチャートを作成します。

1. Kibanaの左側にある「Visualize」をクリックします
2. 青いプラス記号をクリックします
3. この例では、「Vertical Bar」チャートを選択します
4. プロジェクトのルーターログを選択します
5. 「Buckets」の下にある「X-Axis」をクリックし、「Date Histogram」を選択し、間隔を「daily（毎日）」に設定します
6. 成功です！これで、日々のトラフィックを表示するバーチャートが表示されるはずです。

!!! Note "注意:"
    右上隅のデータの適切な時間枠を選択することを確認してください。

以下は、日々のヒット数を可視化したチャートの例です:

![日次ヒット視覚化チャート.](../images/kibana_example5.png)

また、可視化（および検索）を保存できることに注意してください！これにより、将来的にアクセスするのがさらに速くなります。各アカウントには独自のKibanaテナントがあるため、検索や可視化が他のアカウントと共有されることはありません。

## トラブルシューティング

<iframe width="560" height="315" src="https://www.youtube.com/embed/BuQo5J0Qc2c" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
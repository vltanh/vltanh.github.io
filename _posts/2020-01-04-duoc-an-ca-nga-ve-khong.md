---
layout: distill
title: Được ăn cả, ngã về không
date: 2020-01-04
description:
tags: math
categories:
giscus_comments: true

authors:
  - name: The-Anh Vu-Le
    affiliations:
      name:
toc:
  - name: Bối cảnh
  - name: Tiếp cận
    subsections:
      - name: Chiến thuật của Uyên
      - name: Chiến thuật của Thức
      - name: Nhận xét
---

## Bối cảnh

Ở một thành phố nọ có một đôi bạn thân. Tuy chơi với nhau từ bé nhưng hai người lại có tính cách khác biệt nhau, có thể nói là một trời một vực: Uyên thì đa nghi, cẩn trọng; còn Thức thì vô tư, đôi lúc đến bất cẩn.

Cả Uyên và Thức đều mơ ước một ngày được trở thành những nhà huấn luyện Pokemon cừ khôi, nhưng cả hai đều không đủ điều kiện kinh tế để sắm bộ đồ nghề cần thiết. Hôm nay, đúng đợt khuyến mãi sốc - chỉ còn 8 đồng một bộ (tức phải **cần 16 đồng** cho cả hai người), thì cả hai gom góp lại cũng chỉ được **có 5 đồng**. Tuy nhiên, không thể bỏ lỡ cơ hội có một không hai này, cả hai tìm đến đại gia Trung để vay tiền theo đuổi ước mơ.

Đã nghèo còn mắc cái eo, Trung tuy đại gia nhưng lại keo kiệt, còn ham thói cờ bạc. Không muốn cho Uyên hay Thức vay tiền, Trung bày ra một trò "cá cược" như sau. Ở mỗi lượt, người chơi sẽ **đặt cược một số tiền**, và Trung sẽ **tung đồng xu**. Nếu **mặt ngửa**, người chơi sẽ **thắng được thêm số tiền đã cược** (tức nhận lại 2 lần tiền cược), **ngược lại**, người chơi sẽ không được gì (tất nhiên là **mất tiền cược**).

Thức rất hào hứng vì có cơ hội kiếm được tiền mà không phải trả lại. Còn Uyên ngay lập tức nghi ngờ đồng xu của Trung không phải đồng xu cân bằng mà nghiêng nhiều về mặt sấp. Quả thật, đồng xu của Trung chỉ có **40% khả năng là ra mặt ngửa**. Ngặt nỗi, với tình hình này thì chỉ cần không phải 0% thì cứ phải cố mà lấy được, Thức đã thuyết phục Uyên tham gia canh bạc bất lợi như vậy.

Câu hỏi tiếp theo là: chiến thuật đặt cược như thế nào thì hợp lý?

Uyên nghĩ đến một chiến thuật đơn giản: cứ **đặt cược 1 đồng** ở mỗi lượt và chơi tới khi phá sản (0 đồng) hoặc đến khi đạt mục tiêu (16 đồng). Thức thì nghĩ tới một chiến thuật bạo hơn: **đặt cược hết toàn bộ** tiền đang có ở mỗi lượt **trong chừng mực của mục tiêu** (ví dụ đang có 5 đồng thì đặt luôn 5 đồng nhưng nếu có 10 đồng thì chỉ đặt 6 đồng để đạt đúng mục tiêu 16 đồng nếu thắng lượt đó).

Cả Uyên và Thức đều không rõ chiến thuật nào tốt hơn và liệu xác suất ra mặt ngửa của đồng xu có ảnh hưởng đến lựa chọn này. Đúng lúc đang băn khoăn thì anh Long từ đâu xuất hiện, đề xuất sẽ giúp hai đứa em thơ qua cơn khó khăn này. Anh Long bắt đầu diễn giải...

## Tiếp cận

Gọi $X_t$ là số tiền Uyên và Thức có sau lượt $t$. Nhận thấy $X_t$ chỉ nhận giá trị nguyên từ $0$ tới $16$ do trò chơi kết thúc hoặc khi phá sản ($X_t = 0$) hoặc khi đạt mục tiêu ($X_t = 16$) và không chiến thuật nào cho giá trị tiền nằm ngoài khoảng đó.

Gọi $p$ là xác suất đồng xu cho mặt ngửa. Cụ thể ở đây thì $p = 0.4$.

Gọi $P(x, y) = P(X_t = y \|  X_{t-1} = x)$ là xác suất để có $y$ đồng biết ngay trước đó có $x$ đồng. Ta gọi việc này là "chuyển từ trạng thái $x$ (có $x$ đồng) sang trạng thái $y$ (có $y$ đồng)". Ví dụ ở lượt đầu, nếu theo chiến thuật của Uyên đặt cược 1 đồng thì $P(5, 6) = p = 0.4$ (40% là thắng cược có thêm 1 đồng) và $P(5, 4) = 1 - p = 0.6$ (60% thua cược và mất tiền cược); còn theo chiến thuật của Thức đặt cược cả 5 đồng thì $P(5, 10) = 0.4$ và $P(5, 0) = 0.6$.

Một nhận xét có thể rút ra ở đây là xác suất $P(x, y)$ không phụ thuộc số lượt đã trải qua, và cũng không phụ thuộc kết quả các lượt trước đó. Nó cũng không phụ thuộc vào giá trị $x, y$ (do chỉ phụ thuộc vào $p$) nhưng ở đây ta không cần tính chất này.

Gọi $\mu(x)$ là xác suất để Uyên và Thức đạt mục tiêu trước khi phá sản, nếu bắt đầu với $x$ đồng. Dễ thấy, $\mu(0) = 0$ và $\mu(16) = 1$. Ở đây ta muốn so sánh $\mu(5)$ giữa hai chiến thuật, chiến thuật tốt hơn sẽ cho $\mu(5)$ lớn hơn.

### Chiến thuật của Uyên

Một số điều ta biết về chiến thuật này:

- Do trò chơi kết thúc khi phá sản: $P(0, 0) = 1$
- Do trò chơi kết thúc khi đạt mục tiêu: $P(16, 16) = 1$
- Do mỗi lần chỉ đặt cược 1 đồng với xác suất thắng $p = 0.4$: $p_x = P(x, x+1) = 0.4, q_x = P(x, x-1) = 0.6, \forall x \in [1, 15]$

Các xác suất chuyển trạng thái khác (không được nêu ở trên) đều bằng 0.

Nhờ vào nhận xét nêu ở mục trên, ta có hệ thức:

$$
  \mu(x) = p_x \mu(x+1) + q_x \mu(x-1), \forall x \in [1, 15]
$$

Diễn giải bằng lời, có thể hiểu hệ thức đang nói rằng: xác suất phá sản trước khi đạt mục tiêu nếu bắt đầu tại trạng thái $x$ được tính dựa trên việc có xác suất $p_x = P(x, x+1)$ ta sẽ chuyển sang trạng thái $x+1$ và lại bắt đầu từ $x+1$, tương tự có xác suất $q_x = P(x, x-1)$ ta sẽ chuyển đến $x-1$ và bắt đầu từ đó.

Dựa vào việc $p_x + q_x = 1$, ta có:

$$
  \mu(x) = p_x \mu(x+1) + q_x \mu(x-1) + (1 - p_x - q_x) \mu(x)
$$

$$
  \Leftrightarrow \mu(x+1) - \mu(x) = \dfrac{q_x}{p_x} [\mu(x) - \mu(x-1)]
$$

Áp dụng điều vừa chứng minh ta thấy:

$$
  \mu(x) - \mu(x-1) = \dfrac{q_{x-1}}{p_{x-1}}[\mu(x-1) - \mu(x-2)]
$$

và cứ áp dụng tiếp tục thế với mọi $x \in [1, 15]$, ta có

$$
  \mu(x+1) - \mu(x) = \dfrac{q_x q_{x-1} ... q_1}{p_x p_{x-1} ... p_1}[\mu(1) - \mu(0)]
$$

Đặt $\gamma_x = \dfrac{q_x q_{x-1} ... q_1}{p_x p_{x-1} ... p_1}, \gamma_0 = 1$ và lấy tổng hai vế từ 0 đến 15 ta có

$$
  \sum_{x=0}^{15} \mu(x+1) - \mu(x) = \sum_{x=0}^{15} \gamma_x [\mu(1) - \mu(0)]
$$

$$
  \Leftrightarrow \mu(16) - \mu(0) = \sum_{x=0}^{15} \gamma_x [\mu(1) - \mu(0)]
$$

Nhắc lại, $\mu(0) = 0$ và $\mu(16) = 1$ nên

$$
  1 = \sum_{x=0}^{15} \gamma_x \mu(1) \Leftrightarrow \mu(1) = \dfrac{1}{\sum_{x=0}^{15} \gamma_x}
$$

Tương tự trên nhưng chỉ lấy tổng từ 0 đến 4:

$$
  \sum_{x=0}^{4} \mu(x+1) - \mu(x) = \sum_{x=0}^{4} \gamma_x [\mu(1) - \mu(0)]
$$

$$
  \Leftrightarrow \mu(5) - \mu(0) = \sum_{x=0}^{4} \gamma_x [\mu(1) - \mu(0)]
$$

$$
  \Leftrightarrow \mu(5) = \sum_{x=0}^{4} \gamma_x \mu(1) = \dfrac{\sum_{x=0}^{4} \gamma_x}{\sum_{x=0}^{15} \gamma_x}
$$

Để tính $\sum\gamma_x$, nhận thấy:

$$
  \dfrac{q_y}{p_y} = \dfrac{1-p}{p}, \forall y \Rightarrow \gamma_x = \left( \dfrac{1-p}{p} \right)^x \Rightarrow \sum_{x=0}^{n-1} \gamma_x = \dfrac{1-\left( \dfrac{1-p}{p} \right)^n}{1-\left( \dfrac{1-p}{p} \right)}
$$

Áp dụng có

$$
  \mu(5) = \dfrac{1-\left( \dfrac{1-p}{p} \right)^5}{1-\left( \dfrac{1-p}{p} \right)^{16}}
$$

Với $p = 0.4$ ta tính được $\mu(5) \approx 0.01 = 1\%$.

### Chiến thuật của Thức

Theo chiến thuật của Thức, diễn tiến trò chơi sẽ như sau:

- Lượt 1: đặt 5 đồng
  - Thắng: có 10 đồng
  - Thua: phá sản
- Lượt 2 (chỉ khi thắng 1): đặt 6 đồng
  - Thắng: đạt mục tiêu
  - Thua: có 4 đồng
- Lượt 3 (chỉ khi thắng 1, thua 2): đặt 4 đồng
  - Thắng: có 8 đồng
  - Thua: phá sản
- Lượt 4 (chỉ khi thắng 1, thua 2, thắng 3): đặt 8 đồng
  - Thắng: đạt mục tiêu
  - Thua: phá sản

Trò chơi chỉ có thể kéo dài tối đa 4 lượt như thế.

Xác suất đạt mục tiêu lúc này là tổng xác suất các trường hợp:

- Thắng 1, thắng 2
- Thắng 1, thua 2, thắng 3, thắng 4

Như vậy xác suất đó là:

$$
  \mu(5) = p^2 + p(1-p)p^2 = 0.1984 = 19.84\%
$$

### Nhận xét

Như vậy chiến thuật của Thức hiệu quả rõ rệt so với chiến thuật của Uyên. Điều này là nằm trong dự đoán bởi vì trong tình huống trò chơi bất lợi cho mình (xác suất thắng thấp hơn) thì việc đặt cược ít sẽ làm tăng số lần chơi và sự bất lợi sẽ càng tích tụ.

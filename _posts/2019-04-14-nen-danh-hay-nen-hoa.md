---
layout: distill
title: Nên đánh hay nên hòa
date: 2019-04-14
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
        - name: Chiến thuật đơn định
        - name: Chiến thuật ngẫu nhiên
---

## Bối cảnh

> **Miễn trừ trách nhiệm**: Đây là một sản phẩm hư cấu. Tên, nhân vật, công ty, địa điểm, sự kiện đều hoặc là sản phẩm của trí tưởng tượng của tác giả hoặc được sử dụng với ý nghĩa hư cấu. Mọi tương đồng với những người, còn sống hay đã chết, hoặc với những sự kiện thực tế đều là trùng hợp ngẫu nhiên.

Năm 12xx tại kinh thành TL, Thượng hoàng TTT triệu họp các bô lão trong cả nước về trước thềm điện DH để trưng cầu dân ý, hỏi về chiến lược đối phó trước tình hình quân NM lăm le xâm lược ĐV.

Tình thế hiện tại như sau: quân NM đã thiết lập một căn cứ quân sự ngay sát biên giới ĐV và đang đe dọa sẽ có thể tiến công xâm lược bất cứ lúc nào. Ngay lập tức, thượng hoàng ban chiếu chỉ thiết lập một phòng tuyến vững chắc ngay biên giới, mở kho lương và huy động hậu phương tích cực chuẩn bị lương thực để tiếp ứng cho phòng tuyến.

Nhớ lời dạy “Tiên pháp chế nhân” của LTK năm xưa, Thượng hoàng đặt ra cho các bô lão hai lựa chọn, hoặc là tiếp ứng một lượng lớn lương thực (khoảng **10 tấn**) cho một cuộc tấn công bất ngờ vào căn cứ quân sự đối phương, đập tan âm mưu xâm lược, hoặc là tiếp ứng một lượng vừa đủ hàng ngày (**1 tấn**) để giữ vững phòng tuyến và cầu mong nguy hiểm đi qua. Do kho lương có hạn, đặc biệt để tránh nạn đói cho dân, điều cần thiết phải tối thiểu lượng lương thực sử dụng.

Trước câu hỏi của Thượng hoàng, các bô lão bàn bạc kế sách...

## Tiếp cận

Bài toán có thể được phát biểu lại như sau:

> Giả sử vào buổi sáng mỗi ngày $x \geq 1$, các bô lão phải đưa ra lựa chọn giữa **cấp $b$ tấn lương thực** cho một cuộc tổng tấn công chấm dứt hoặc **cấp 1 tấn lương thực** đủ để giữ phòng tuyến cho ngày hôm đó. Tại một thời điểm trong **ngày $D$**, việc giữ phòng tuyến sẽ chấm dứt (có thể do nguy hiểm đi qua, hoặc bị xâm lược,...). Tìm cách giảm tối đa chi phí của chiến dịch này.

Trong trường hợp **ngoại tuyến**, tức là biết trước ngày $D$ là ngày nào, rõ ràng các bô lão có thể ngay lập tức biết là mình nên cấp lượng lớn một lần hay cấp hàng ngày. Chi phí lúc này là **$\min(D,b)$**. Đó cũng chính là **chi phí ngoại tuyến tối ưu** cho bài toán này.

Thế nhưng, trong tình thế này, chúng ta lại cần các chiến thuật **trực tuyến**, tức là phải đưa ra quyết định ở buổi sáng mỗi ngày, chỉ biết thông tin trong quá khứ chứ không biết tương lai (cụ thể là không biết khi nào thì sẽ dừng lại). Các chiến thuật trực tuyến rõ ràng là sẽ **không hiệu quả bằng** các chiến thuật ngoại tuyến, hay chi phí trực tuyến sẽ lớn hơn chi phí ngoại tuyến. Cụ thể, giá trị $c$ được gọi là **tỷ lệ cạnh tranh** của một thuật toán trực tuyến khi với mọi đầu vào, chi phí của nó bằng **tối đa $c$ lần** chi phí ngoại tuyến tối ưu. Ta muốn tỷ lệ này **càng nhỏ càng tốt**.

Ta xét một số ví dụ. Giả sử chiến thuật của các bô lão là “Đánh” (tổng tấn công ngay lập tức). Như vậy, Thượng hoàng sẽ cấp ngay $b$ tấn, hay nói cách khác, chi phí trực tuyến là $b$ tấn. Trong tình huống xấu nhất là chiến dịch kết thúc ngay sau ngày đầu, chi phí ngoại tuyến là 1 tấn, chỉ bằng $$1/b$$ chi phí trực tuyến. Ta nói chiến thuật này có tỷ lệ cạnh tranh là $b$.

Hoặc giả sử chiến thuật của các bô lão là “Hòa” (giữ vững phòng tuyến). Lúc này, chi phí trực tuyến sẽ là $D$ tấn trong khi chi phí ngoại tuyến tối ưu là $\min(D,b)$ tấn. Như vậy, với $D$ càng lớn (chiến lược càng dài hơi) thì tỉ lệ chi phí trực tuyến và chi phí ngoại tuyến tối ưu càng lớn (với $D < b$, tỉ lệ này là 1 và với $D \geq b$, tỉ lệ này là $D/b$ tăng theo $D$). Nói cách khác, tỷ lệ cạnh tranh của chiến thuật này có thể lớn tùy ý.

### Chiến thuật đơn định

Một chiến thuật trực tuyến tất định sẽ **chọn một ngày $t$**, **cấp lương thực hàng ngày cho $t-1$ ngày đầu** và **cấp lương thực để tấn công trong buổi sáng ngày $t$** nếu như chiến dịch vẫn chưa kết thúc. Lúc này, chi phí của chiến thuật, hay **chi phí trực tuyến**, sẽ là **$D$ nếu $D < t$** và là **$t-1+b$ nếu $D \geq t$**.

Khi $D \geq t$, tỷ lệ sẽ là $(t-1+b)/\min(D,b)$ là một hàm giảm theo $D$. Như vậy, trường hợp xấu nhất xảy ra khi $D = t$ với tỷ lệ là

$$
    \dfrac{t-1+b}{\min(t,b)} = 1 + \dfrac{\max(t+b)}{\min(t,b)} - \dfrac{1}{\min(t,b)}
$$

Khi **$D < t$**, tỷ lệ sẽ là **$D/\min(D,b)$** là một hàm tăng theo $D$. Như vậy, **trường hợp xấu nhất** xảy ra khi **$D = t-1$** với tỷ lệ là

$$
    \dfrac{t-1}{\min(t-1,b)} \leq \dfrac{t}{\min(t-b)} < \dfrac{t-1+b}{\min(t,b)}
$$

Như vậy, trường hợp xấu nhất là khi **$D = t$** (nói cách khác, chiến dịch kết thúc ngay khi ta cấp lương thực cho một cuộc tổng tấn công). Vậy **tỷ lệ cạnh tranh** chính bằng

$$
    c = 1 + \dfrac{\max(t,b)}{\min(t,b)} - \dfrac{1}{\min(t,b)}
$$

Tỷ lệ này **đạt cực tiểu khi $t = b$** và bằng

$$
    \min c = 2 - \dfrac{1}{b}
$$

Như vậy, các bô lão của chúng ta đề xuất **chiến thuật tất định tối ưu** là: **cấp lương thực hàng ngày cho 9 ngày đầu** và **cấp lương thực lớn để tổng tấn công ở ngày thứ 10** nếu chiến dịch chưa kết thúc trước đó. Chiến thuật này cho **tỷ lệ cạnh tranh là 1.9**.

### Chiến thuật ngẫu nhiên

Một chiến thuật ngẫu nhiên sẽ **chọn ngẫu nhiên một ngày $T$ từ một phân bố xác suất xác định, cấp lương thực hàng ngày cho $T-1$ ngày đầu và cấp lương thực lớn cho tổng tấn công vào ngày $T$**. Như vậy, với mỗi giá trị $T = t$, ta có **chi phí trực tuyến**, sẽ là **$D$ nếu $D < t$** và là **$t-1+b$ nếu $D \geq t$**.

Ta xét bài toán tối ưu hóa với $p_t$ là xác suất ngày thứ $t$ được chọn: tối thiểu c sao cho

$$
    \sum_{t=1}^{D} (t-1+b)p_t + D \sum_{j > D} p_j \leq c \min(D, b), \forall D \geq 1.
$$

Đây là một bài toán quy hoạch tuyến tính vô hạn (do D nhận giá trị vô hạn). Ta có thể chứng minh (xem [1]) bài toán này tương đương với bài toán tối thiểu $c$ sao cho

$$
    \sum_{t=1}^{D} (t-1+b)p_t + D \sum_{D < j \leq b} p_j = Dc, 1 \leq D \leq b.
$$

Giải nghiệm hệ phương trình, ta tìm được

$$
    p_i = \left ( 1- \dfrac{1}{b} \right)^{b-i} \dfrac{c}{b}, 1 \leq i \leq b.
$$

Với tổng các $p_i$ bằng 1, ta tìm được giá trị tỷ lệ cạnh tranh

$$
    c = \dfrac{b}{\sum_{0 \leq i < b} \left ( 1- \dfrac{1}{b} \right)^{b-i}} = \dfrac{b}{\dfrac{1-(1-1/b)^b}{1-(1-1/b)}} = \dfrac{1}{1-(1-1/b)^b}.
$$

Với $b$ càng lớn, ta có tỷ lệ cạnh tranh càng tăng và khi $b$ tiến tới vô cùng, giá trị này xấp xỉ

$$
    \lim_{b\to\infty} c = \dfrac{1}{1-e^{-1}} = \dfrac{e}{e-1}.
$$

Như vậy, các bô lão có thể đề xuất một **chiến thuật ngẫu nhiên** như sau: tìm phân phối xác suất của $T$ như trên và chọn ngẫu nhiên $t$ từ phân phối đó, cấp lương thực hàng ngày cho $t-1$ ngày đầu và cấp lương thực để tổng tấn công vào ngày thứ $t$. Chiến thuật này cho **tỉ lệ cạnh tranh là 1.535**, tốt hơn cả cho chiến thuật đơn định.

# Tham khảo

1. [Online algorithms](http://cs.brown.edu/~claire/Talks/skirental.pdf): Ski rental, Brown University

2. [Ski rental problem](https://en.wikipedia.org/wiki/Ski_rental_problem), Wikipedia

[1]: http://cs.brown.edu/~claire/Talks/skirental.pdf

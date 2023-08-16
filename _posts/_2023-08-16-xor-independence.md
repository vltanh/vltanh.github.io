---
layout: distill
title:  XOR và sự độc lập 
date: 2023-08-16
description:
tags: math
categories: 
giscus_comments: true

authors:
  - name: The-Anh Vu-Le
    affiliations:
      name: 
toc:
  - name: XOR là gì?
    # subsections:
    #     - name: Mô hình năng lượng
    #     - name: Máy Boltzmann
    #     - name: Máy Boltzmann giới hạn
  - name: Hai sự kiện là độc lập khi nào?
    # subsections:
    #     - name: Chặn dưới biến phân
    #     - name: Xấp xỉ mean-field
#   - name: Tính chất thú vị của phép XOR
---

## XOR là gì?

Giữa các biến kiểu luận lý (boolean variable, biến nhận giá trị $$0$$ hoặc $$1$$) có tồn tại nhiều phép toán như $$\text{AND}$$, ký hiệu $$\cdot$$,
$$
\begin{align}
    x \cdot y = \left\{
        \begin{array}{ll}
            1 & \text{ nếu } x = y = 1 \\
            0 & \text{ khác }
        \end{array}
    \right.
\end{align}
$$
hay $$\text{OR}$$, ký hiệu $$+$$, 
$$
\begin{align}
    x + y = \left\{
        \begin{array}{ll}
            1 & \text{ nếu } x = 1 \text{ hoặc } y = 1 \\
            0 & \text{ khác }
        \end{array}
    \right.
\end{align}
$$

Một phép toán khác cũng rất quan trọng là $$\text{XOR}$$ (exclusive OR), ký hiệu $$\oplus$$,
$$
\begin{align}
    x \oplus y = \left\{
        \begin{array}{ll}
            1 & \text{ nếu } x \neq y \\
            0 & \text{ khác }
        \end{array}
    \right.
\end{align}
$$

Điều này nghĩa là phép $$\text{XOR}$$ chỉ khác với phép $$\text{OR}$$ ở duy nhất một điểm là nếu $$x$$ và $$y$$ đều bằng $$1$$ thì $$x \oplus y = 0$$ thay vì bằng $$1$$ như trong phép $$\text{OR}$$.

Trong bài viết này, chúng ta sẽ tìm hiểu một tính chất khá thú vị của phép $$\text{XOR}$$, liên quan đến xác suất và tính độc lập của các sự kiện. Bài viết giả định người đọc đã có kiến thức cơ bản về xác suất và thống kê.

## Hai sự kiện là độc lập khi nào?

Khái niệm độc lập (independence) là một khái niệm thú vị trong xác suất bởi nó có thể dễ dàng bị hiểu nhầm, một phần là do tên gọi ''độc lập'' khiến mọi người liên tưởng đến những tính chất khác, phần còn lại có lẽ do định nghĩa hình thức của nó khá là không trực quan.

Có lẽ định nghĩa quen thuộc nhất là: 

> ##### Definition 1.1 (Độc lập)
> Hai sự kiện $$A$$ và $$B$$ được gọi là độc lập khi và chỉ khi 
> 
> $$
>   \mathbb{P}(A \cap B) = \mathbb{P}(A) \mathbb{P}(B)
> $$
{: .block-danger }

Ta thử xét một trường hợp nhầm lẫn thường thấy. Giả sử ta có không gian mẫu $$\Omega = \{1, 2, \dots, 10\}$$ và các sự kiện $$A_x = \{1, \dots, x\}$$ và $$B_y = \{y, \dots, 8\}$$. 

Hai sự kiện $$A_3$$ và $$B_5$$ thường bị nhầm là độc lập với nhau vì $$A_3 \cap B_5 = \emptyset$$ cho cảm giác hai tập hợp này ''độc lập''. Tuy nhiên, trên thực tế, nếu chiếu theo định nghĩa trên thì hai sự kiện này không được gọi là độc lập với nhau. Cụ thể, $$\mathbb{P}(A_3) = 0.3$$, $$\mathbb{P}(B_5) = 0.4$$ tức $$\mathbb{P}(A_4) \mathbb{P}(B_6) = 0.12$$ khác với $$\mathbb{P}(A_4 \cap B_6) = \mathbb{P}(\emptyset) = 0$$. Ở đây, để đúng về mặt khái niệm, ta có thể nói $$A_4$$ và $$B_6$$ là hai sự kiện xung khắc (mutually exclusive).

Ta có thể kiểm tra $$A_6$$ và $$B_4$$ mới chính là hai sự kiện độc lập. Cụ thể, $$\mathbb{P}(A_6) = 0.6$$, $$\mathbb{P}(B_4) = 0.5$$ nên $$\mathbb{P}(A_6) \mathbb{P}(B_4) = 0.3$$ bằng với $$\mathbb{P}(A_6 \cap B_4) = \mathbb{P}(\{4, 5, 6\}) = 0.3$$.

Ý tưởng then chốt của khái niệm độc lập nằm ở việc hai sự kiện $$A$$ và $$B$$ là độc lập khi và chỉ khi việc xảy ra sự kiện $$A$$ không ảnh hưởng đến việc xảy ra sự kiện $$B$$ và ngược lại. Tức là, nếu ta biết sự kiện $$A$$ đã xảy ra, thì xác suất để sự kiện $$B$$ xảy ra vẫn giữ nguyên. Tương tự, nếu ta biết sự kiện $$B$$ đã xảy ra, thì xác suất để sự kiện $$A$$ xảy ra vẫn giữ nguyên.

Trong ví dụ ở trên, việc ta biết được số được chọn thuộc $$\{1, \dots, 6\}$$

### Tính độc lập giữa hai biến ngẫu nhiên
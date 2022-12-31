---
layout: distill
title: Hai thế giới
date: 2019-03-31
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
        - name: Phương trình quỹ đạo
        - name: Tầm bay xa
        - name: Tầm bay cao
        - name: Tầm với/Phạm vi
  - name: Lời kết
  - name: Phụ lục
---

## Bối cảnh

Ở vương quốc nọ có cô họa sĩ nổi danh với nhiều tác phẩm độc, lạ, được thực hiện bằng nhiều cách thức độc đáo khác nhau. Một trong những tuyệt tác của cô là tác phẩm ``Hai thế giới'' (xem hình). Ở đó, cô đã phác họa nên sự phân biệt rạch ròi của hai vương quốc, một vương quốc thì rực rỡ sắc màu, trong khi vương quốc còn lại thì chìm trong một màu trắng mờ nhạt.

{% include figure.html path="assets/img/2019-03-31_images/two-worlds.png" class="img-fluid" zoomable=true %}

Trong một buổi phỏng vấn, cô đã tiết lộ phương pháp thú vị mà cô đã dùng để vẽ nên bức tranh đặc biệt này:

- Khung tranh là một hình chữ nhật đặt nằm ngang.
- Cô sẽ đứng cố định ở góc trái dưới của khung tranh, trong tay là vô số các quả bóng chứa đầy các màu sắc rực rỡ.
- Cô lần lượt ném các quả bóng với tốc độ đầu và góc ném khác nhau về phía đầu kia của khung tranh. Do thể lực có giới hạn nên cô chỉ có thể ném xa tối đa là đến đúng góc phải dưới của khung tranh.
- Trong quá trình bay trong không trung, quả bóng sẽ vỡ ra và vẽ nên quỹ đạo của mình lên khung tranh.

Nghe xong, ai cũng tò mò không biết tại sao một phương pháp đơn giản vậy lại vẽ ra được một tuyệt phẩm như thế, đặc biệt với đường biên giữa hai thế giới gần như là một đường cong hoàn hảo.
Họ đặt câu hỏi cho cô họa sĩ. Do dự một hồi, cô bắt đầu giải thích...

## Tiếp cận

Khi nói đến ném một vật có góc và tốc độ đầu, ta nghĩ ngay đến bài toán ném xiên được học trong chương trình Vật lý lớp 10.

### Phương trình quỹ đạo

Xét hệ trục tọa độ Oxy với gốc O nằm ở vị trí ném (tức góc trái dưới bức tranh); phương ngang Ox song song với mặt đất, chiều từ trái sang phải (tức theo hướng ném); phương đứng vuông góc với mặt đất, chiều từ dưới lên trên.

Truyền cho quả bóng một vận tốc đầu có độ lớn $v_0$ và góc lệch $\alpha$ so với mặt đất. Vận tốc ban đầu trên hai phương đứng và ngang là

$$
    \left\{
    \begin{array}{lcl}
        v_{0x} &=& v_0 \cos \alpha \\
        v_{0y} &=& v_0 \sin \alpha
    \end{array}
    \right.
$$

Trên phương ngang, quả bóng không chịu lực tác dụng nào và do đó vận tốc không đổi theo thời gian. Trên phương đứng, quả bóng chịu tác dụng của trọng lực và do đó có gia tốc $-g$ với $g = 9.81$ là trọng trường Trái Đất. Vận tốc tại thời điểm $t$ bất kì là

$$
    \left\{
    \begin{array}{lclcl}
        v_x(t) &=& v_{0x} &=& v_0 \cos \alpha \\
        v_y(t) &=& v_{0y} - gt &=& v_0 \sin \alpha - gt
    \end{array}
    \right.
$$

Dựa vào phương trình chuyển động thẳng biến đổi đều

$$
    x = x_0 + v_0 t + \frac{1}{2}at^2
$$

ta có thể xác định phương trình quỹ đạo quả bóng theo tham số thời gian $t$. Ban đầu, vật bắt đầu tại vị trí $(x_0, y_0) = (0, 0)$. Tọa độ của vật tại thời điểm $t$ là

$$
    \left\{
    \begin{array}{lcl}
        x(t) &=& v_0 (\cos \alpha) t \\
        y(t) &=& v_0 (\sin \alpha) t - \frac{1}{2} gt^2
    \end{array}
    \right.
$$

Từ phương trình tham số, ta thu được phương trình đường cong quỹ đạo quả bóng

$$
    y = \dfrac{-g}{2 v_0^2 \cos^2 \alpha} x^2 + (\tan \alpha) x
$$

Với mỗi giá trị $\alpha$ khác nhau, ta lại thu được một quỹ đạo khác nhau (xem hình).

Đến đây, chắc hẳn mọi người đã hình dung ra được, với góc ném $\alpha$ thay đổi, cô họa sĩ đã tạo nên bức tranh như thế nào.

### Tầm bay xa

Tầm bay xa là khoảng cách xa nhất theo phương ngang mà quả bóng có thể đạt được. Ta có thể tìm thấy tầm bay xa khi xét vị trí xa nhất (trên phương ngang) mà quả bóng tiếp đất.

Gọi $t_L$ là thời điểm quả bóng tiếp đất. Ta có $y(t_L) = 0$ hay

$$
    v_0 (\sin \alpha) t_L - \frac{1}{2} gt_L^2 = 0
$$

Giải phương trình trên, ngoài nghiệm tầm thường $t_L = 0$ (lúc vừa bắt đầu ném), ta có nghiệm

$$
    t_L = \dfrac{2 v_0 \sin \alpha}{g}
$$

Khi đó, hoành độ tiếp đất của quả bóng là

$$
    x(t_L) = v_0 (\cos \alpha) \dfrac{2 v_0 \sin \alpha}{g} = \dfrac{v^2_0 \sin (2 \alpha)}{g}
$$

Giá trị này đạt cực đại khi $\alpha = \pi/4$. Lúc này,

$$
    L = \dfrac{v^2_0}{g}
$$

Như vậy, với góc ném 45 độ quả bóng sẽ bay được xa nhất. Ngoài ra, để ý tốc độ đầu càng lớn thì tầm bay xa cũng càng lớn.

### Tầm bay cao

Tầm bay cao là chiều cao tối đa (khoảng cách cực đại theo phương đứng) mà quả bóng có thể đạt được. Ta có thể tìm được tầm bay cao khi xét thời điểm vận tốc theo phương đứng chuyển dấu (tức thay vì hướng lên thì hướng xuống).

Gọi $t_H$ là thời điểm quả bóng đạt vị trí cao nhất trong quỹ đạo. Ta có $v_y(t_H) = 0$ hay

$$
    v_0 \sin \alpha - gt_H = 0
$$

Giải phương trình trên, ta có nghiệm

$$
    t_H = \dfrac{v_0 \sin \alpha}{g}
$$

Như vậy, đối với một góc ném $\alpha$ bất kì, chiều cao tối đa quả bóng đạt được là

$$
    y(t_H) = v_0 (\sin \alpha) \dfrac{v_0 \sin \alpha}{g} - \frac{1}{2} g \left(\dfrac{v_0 \sin \alpha}{g}\right)^2 = \dfrac{v^2_0 \sin^2 \alpha}{2g}
$$

Giá trị này đạt cực đại khi $\alpha = \pi / 2$. Lúc này,

$$
    H = \dfrac{v^2_0}{2g}
$$

Như vậy, với góc ném 90 độ (ném thẳng lên trời) thì quả bóng đạt được chiều cao tối đa có thể. Tương tự tầm bay cao cũng càng lớn khi tốc độ đầu càng lớn.

### Tầm với/Phạm vi

Đến đây, chúng ta sẽ lý giải tại sao hai thế giới trong bức tranh có thể được phân định rạch ròi bằng một đường cong như thế, cũng như tìm phương trình của đường cong này.

Ta khảo sát phạm vi của quả bóng, tức là tập hợp các điểm mà quả bóng có thể bay đến được. Nói cách khác, ta tìm tất cả các điểm $(x,y)$ sao cho tồn tại ít nhất một quỹ đạo (quyết định bởi góc $\alpha$ và tốc độ đầu $v_0$) đi qua điểm đó.

Nhắc lại phương trình quỹ đạo ứng với một góc $\alpha$ và tốc độ đầu $v_0$:

$$
    y = \dfrac{-g}{2 v_0^2 \cos^2 \alpha} x^2 + (\tan \alpha) x
$$

Biến đổi phương trình trên, biết $1 / \cos^2 x = 1 + \tan^2 x$,

$$
    \dfrac{-g}{2 v_0^2} x^2 \tan^2 \alpha + x \tan \alpha + \dfrac{-g}{2 v_0^2} - y = 0
$$

Phương trình có dạng $Az^2 + Bz + C = 0$ với $z = \tan \alpha$ và là một phương trình bậc 2. Đối với lại mỗi điểm $(x, y)$ trong không gian, ta có thể tìm được quỹ đạo đi qua điểm này (chính xác hơn là tìm được góc $\alpha$ để tạo thành quỹ đạo đó) bằng cách giải phương trình này. Và do đó, tất cả những điểm $(x, y)$ mà quả bóng có thể đạt đến được chính là những điểm làm cho phương trình có nghiệm.

Ta xét giá trị $\Delta$ của phương trình bậc 2 trên

$$
    \Delta = B^2 - 4AC = x^2 - 4 \dfrac{-g}{2 v_0^2} x^2 \left( \dfrac{-g}{2 v_0^2} x^2 - y \right)
$$

Phương trình có nghiệm khi $\Delta \geq 0$, tức

$$
\begin{array}{crcl}
    & 1 - \dfrac{2g}{2 v_0^2} \left( \dfrac{g}{2 v_0^2} x^2 + y \right) &\geq& 0 \\
    \Leftrightarrow& y &\leq& \dfrac{-g}{2 v_0^2} x^2 + \dfrac{v^2_0}{2g}
\end{array}
$$

Như vậy, các điểm mà quả bóng đạt đến được là tất cả các điểm nằm dưới parabol

$$
    (C): y \leq \dfrac{-g}{2 v_0^2} x^2 + \dfrac{v^2_0}{2g}
$$

Và ta có được phương trình đường cong ``biên giới'' cần tìm.

Một thông tin thú vị có thể mọi người sẽ quan tâm là diện tích của “thế giới sắc màu”.

Hoành độ giao điểm của $(C)$ và trục $Ox$ là $L = v^2_0 / g$. Ta có diện tích bằng

$$
\begin{array}{lcl}
    S &=& \displaystyle \int_{0}^{v^2_0/g} \dfrac{-g}{2 v_0^2} x^2 + \dfrac{v^2_0}{2g} dx \\
    &=& \displaystyle \dfrac{-g}{2 v_0^2} \dfrac{1}{3} \left( \dfrac{v^2_0}{g} \right)^3 + \dfrac{v^2_0}{2g} \dfrac{v^2_0}{g} \\
    &=& \dfrac{1}{3} \dfrac{v^4_0}{g^2} \\
    &=& \dfrac{2}{3} \dfrac{v^2_0}{g} \dfrac{v^2_0}{2g} = \dfrac{2}{3} LH
\end{array}
$$

Có thể thấy ``thế giới sắc màu'' thực chất chiếm hơn một nửa vũ trụ của cô họa sĩ (thật ra chúng ta đều có thể thấy trên bức tranh, ở đây chỉ cung cấp con số chính xác).

## Lời kết

Thật ra thì bài toán ném xiên có ý nghĩa khá đặc biệt với mình vì gần như nó là lần đầu tiên mình cảm thấy được ý nghĩa của việc mô hình hóa một vấn đề thực tế (vật lý), giải quyết nó bằng toán học và diễn giải ý nghĩa thực tế của kết quả.

Nhân dịp làm đề Big Bang Online 2019, mình thấy câu này thú vị (và gợi lại kỷ niệm xưa) nên viết thử. Trong thời gian làm thì mình làm không ra, sau đó có bạn mình khai sáng thì mình mới ngộ ra chân lý. Nói chung là mình cũng xin cảm ơn ban ra đề nói riêng và ban tổ chức nói chung vì một bài toán (lý) thú vị.

## Phụ lục

### Phụ lục 1

Đoạn mã nguồn để tạo ra bức tranh như trên:

```python
import matplotlib.pyplot as plt 
import numpy as np 
import random as rd 

g = 10.0
v_max = 10.0 * np.sqrt(2)

num_throws = 50000

def f(x, v, alpha): 
    return -g / (2 * v**2 * np.cos(alpha)**2) * x**2 + np.tan(alpha) * x
    
for _ in range(num_throws): 
    alpha = np.pi / 2.0 * rd.random() 
    v_0 = v_max * rd.random() 
    L = v_0**2 * np.sin(2 * alpha) / g
    X = np.linspace(0, L, 100)
    Y = f(X, v_0, alpha)
    plt.plot(X, Y)

plt.xticks([])
plt.yticks([])
plt.tight_layout()
plt.show()
```

### Phụ lục 2

Mô phỏng bài toán: [Link](https://www.desmos.com/calculator/a5gtcrck6w)

## Tham khảo

1. SGK Vật Lý lớp 10

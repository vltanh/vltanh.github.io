---
layout: distill
title:  Máy Boltzmann (Phần 1)
date: 2022-04-26
description:
tags: math
categories: 
giscus_comments: true

authors:
  - name: The-Anh Vu-Le
    affiliations:
      name: 
toc:
  - name: Tổng quan
    subsections:
        - name: Mô hình năng lượng
        - name: Máy Boltzmann
        - name: Máy Boltzmann giới hạn
  - name: Tính toán
    subsections:
        - name: Chặn dưới biến phân
        - name: Xấp xỉ mean-field
---

## Tổng quan

### Mô hình năng lượng
  
Mô hình năng lượng (energy-based model) là một họ các phân phối có hàm mật độ được định nghĩa trên một siêu hộp (hypercube) $$\{ 0, 1 \}^d$$
$$
\begin{align}
    p(x; \theta) = \dfrac{1}{Z(\theta)} \exp(-E(x; \theta))
\end{align}
$$
trong đó
$$
\begin{align}
    Z(\theta) = \sum_{x \in \{0, 1\}^d} \exp(-E(x; \theta))
\end{align}
$$
là hệ số chuẩn hóa (normalization factor). Ngoài ra, $$Z$$ còn được gọi là hàm phân hoạch (partition function).

Một đặc điểm của các phân phối thuộc dạng này là nó phụ thuộc vào hàm năng lượng $$E$$, được tham số hóa bởi $$\theta$$. Hàm này gán một giá trị năng lượng cho từng cấu hình (configuration) $$x$$. Có thể nhận thấy, các cấu hình có năng lượng càng thấp (càng âm) thì sẽ có xác suất càng cao.

Một tính chất đáng quan tâm khác là hàm $$Z$$ thường rất khó để tính: một cách ngây thơ sẽ là duyệt qua tất cả $$2^d$$ cấu hình có thể. Do đó, việc lấy mẫu (sampling) hoặc suy luận (inference) từ mô hình năng lượng sẽ gặp các khó khăn nhất định.

### Máy Boltzmann

Máy Boltzmann (Boltzmann machine) là một mô hình năng lượng với cấu trúc đặc biệt. Một cấu hình được phân thành 2 phần $$x = (v, h)$$: các trạng thái hiện (visible states) $$v \in \{0, 1\}^{d_v}$$ và trạng thái ẩn (hidden states) $$h \in \{ 0, 1 \}^{d_h}$$. Máy Boltzmann tổng quát có hàm năng lượng được tham số hóa bởi $$\theta = (W, A, B, a, b)$$ với $$W \in \mathbb{R}^{d_h \times d_v}$$, $$A \in \mathbb{R}^{d_v \times d_v}$$, $$B \in \mathbb{R}^{d_h \times d_h}$$, $$a \in \mathbb{R}^{d_v}$$, $$b \in \mathbb{R}^{d_h}$$ và có dạng như sau
$$
\begin{align}
    E(v, h; W, A, B, a, b) = - \langle v, Wh \rangle - \dfrac{1}{2} \langle v, Av \rangle - \dfrac{1}{2} \langle h, Bh \rangle - \langle v, a \rangle - \langle h, b \rangle
\end{align}
$$

Có thể hiểu là $$W$$ mô hình tương tác giữa trạng thái hiện và trạng thái ẩn, $$A, B$$ lần lượt mô hình tương tác giữa các trạng thái hiện và tương tác giữa các trạng thái ẩn.

Khi ta mô hình hóa một tập dữ liệu sử dụng máy Boltzmann, với mỗi điểm dữ liệu, chúng ta thường xem phần quan sát được là trạng thái hiện, và kèm với nó là các trạng thái ẩn không quan sát được. Từ đó, ta hy vọng có thể mô hình hóa được các tương tác ẩn không quan sát được từ dữ liệu hiện có. Phân phối biên (marginal distribution) của trạng thái hiện được tính như sau.
$$
\begin{align}
    p(v; \theta) = \sum_{h \in \{0, 1\}^{d_h}} p(v, h; \theta)
\end{align}
$$

### Máy Boltzmann giới hạn

Máy Boltzmann giới hạn (Restricted Boltzmann Machine) là một trường hợp cụ thể của máy Boltzmann khi không có tương tác giữa các trạng thái hiện với nhau, cũng như không có tương tác giữa các trạng thái ẩn với nhau.

Do đó, hàm năng lượng chỉ là
$$
\begin{align}
    E(v, h; W, a, b) = - \langle v, Wh \rangle - \langle v, a \rangle - \langle h, b \rangle
\end{align}
$$

Có thể xem máy Boltzmann giới hạn như là một máy Boltzmann với $$A = B = 0$$.

## Tính toán

### Chặn dưới biến phân

Một cách để xấp xỉ $$p(v, h; \theta)$$ chính là phương pháp suy diễn biến phân (variational inference). Mục tiêu cụ thể của phương pháp này là ước lượng hợp lý cực đại (maximum likelihood estimation): tìm tham số $$\theta$$ sao cho hàm hợp lý là lớn nhất. Như đã nói ở trên, điều này khó có thể được thực hiện trực tiếp. Do đó, cách tiếp cận là (1) đề xuất một họ mô hình (phân bố) mà ta có thể suy diễn được và (2) tối ưu để có thể sử dụng mô hình này để xấp xỉ mô hình gốc của chúng ta.

Cụ thể, chọn phân bố $$q(h \\| v; \phi)$$ là mô hình của chúng ta về trạng thái ẩn khi biết trạng thái hiện, được tham số hóa bởi $$\phi$$. Ta có thể tìm được chặn dưới của hàm log-likelihood (xin phép không dịch, nôm nà là log của hàm hợp lý) như sau.

Đầu tiên, ta biến đổi hàm này thành dạng
$$
\begin{align}
    \begin{split}
        \log p(v; \theta) =& \log \sum_{h} p(v, h; \theta) \\
        =& \log \sum_{h} \dfrac{p(v, h; \theta)}{q(h | v; \phi)} q(h | v; \phi) \\
        =& \log \left[
            \mathbb{E}_{h \sim q(h|v; \phi)} \dfrac{p(v, h; \theta)}{q(h | v; \phi)}
        \right]
    \end{split}
\end{align}
$$

Sử dụng bất đẳng thức Jensen cho hàm lõm $$\log$$, ta có chặn dưới
$$
\begin{align}
    \begin{split}
    \log p(v; \theta) & \geq \mathbb{E}_{h \sim q(h | v; \phi)} \left[
        \log \dfrac{p(v, h; \theta)}{q(h | v; \phi)}
    \right] \\
    & = \mathbb{E}_{h \sim q(h | v; \phi)} \log p(v, h; \theta) + H(q(h | v; \phi)) \\
    & =: \text{ELBO}(\phi)
    \end{split}
\end{align}
$$

với $$H(q(h \\| v; \phi)) = - \mathbb{E}_{h \sim q(h \\| v; \phi)} \log q(h \\| v; \phi)$$ là entropy của $$q(h \\| v; \phi)$$.

Việc tìm tham số $$\theta$$ để tối ưu log-likelihood trở thành việc tìm cặp tham số $$(\theta, \phi)$$ để tối ưu chặn dưới này.

### Xấp xỉ mean-field

Ta xét cụ thể một lớp các phân bố $$q(h \\| v; \phi)$$ có thể phân rã như sau. Điều này có nghĩa là khi biết trạng thái hiện $$v$$, các trạng thái ẩn được giả định là độc lập với nhau. Giả định này có thể không hợp lý trong thực tế, nhưng lại giúp đỡ rất nhiều trong nghiên cứu và ứng dụng. Phương pháp này được gọi là xấp xỉ mean-field (mean-field approximation).
$$
\begin{align}
    q(h | v; \phi) = \prod_{j=1}^d q(h_j | v; \phi)
\end{align}
$$

trong đó $$\phi = (\mu_j)_{j=1}^{d}$$ với $$\mu_j = q(h_j = 1 \\| v), \forall j = 1, \dots, d_h$$.

Với lựa chọn này, ta có thể chứng minh được $$\mu_j$$ thỏa mãn
$$
\begin{align}
    \label{eq:mu_j}
    \mu_j = \sigma \left( \sum_{i} W_{ij} v_i + \sum_{l \neq j} A_{lj} \mu_l + b_j \right)
\end{align}
$$

Gọi $$h_{-j} = (h_1, \dots, h_{j-1}, h_{j+1}, \dots, h_{d_h})$$. Nói cách khác, $$h_{-j}$$ bao gồm mọi giá trị của $$h$$ trừ $$h_j$$.

Chọn một chiều $$j \in \{ 1, \dots, d_h \}$$ cụ thể. Ta có thể tìm $$\mu_j$$ để tối ưu chặn dưới biến phân bằng cách phương pháp đạo hàm. Do đó, ta sẽ tìm đạo hàm của $$\text{ELBO}(\phi)$$ theo $$\mu_j$$.

Trước hết, ta xét hạng tử entropy.
$$
\begin{align}
    \begin{split}
        H(q(h | v; \phi)) =& - \sum_h q(h | v; \phi) \sum_{k=1}^{d} \log q(h_k|v; \phi) \\
        =& - \sum_{k=1}^{d} \sum_{h_k, h_{-k}} q(h_k|v; \phi) q(h_{-k}|v; \phi) \log q(h_k|v; \phi) \\
        =& - \sum_{k=1}^{d} \sum_{h_{-k}} q(h_{-k}|v; \phi) \sum_{h_k} q(h_k|v; \phi) \log q(h_k|v; \phi) \\
        =& - \sum_{k=1}^{d} \sum_{h_k} q(h_k|v; \phi) \log q(h_k|v; \phi) \\
        =& - \sum_{k=1}^{d} \mu_k \log \mu_k + (1 - \mu_k) \log (1 - \mu_k)
    \end{split}
\end{align}
$$

Do chỉ quan tâm đến $\mu_j$, trong biểu thức này, ta chỉ quan tâm đến hạng tử
$$
\begin{align}
    - \mu_j \log \mu_j - (1 - \mu_j) \log (1 - \mu_j)
\end{align}
$$

Tiếp đến, để phân tích hạng tử kỳ vọng, ta thực hiện phân rã sau.
$$
\begin{align}
    \begin{split}
    p(v, h; \theta) & = p(v; \theta) p(h|v;\theta) \\
    & = p(v; \theta) p(h_{-j} | v; \theta) p(h_j|h_{-j}, v;\theta)
    \end{split}
\end{align}
$$

Như vậy,
$$
\begin{align}
    \begin{split}
    & \mathbb{E}_{h \sim q(h|v;\phi)} \log p(v,h;\theta) \\
    = &
    \mathbb{E}_{h \sim q(h|v;\phi)} [
        \log p(v; \theta)
        + \log p(h_{-j} | v; \theta)
        + \log p(h_j | h_{-j}, v; \theta)
    ]
    \end{split}
\end{align}
$$

Hạng tử thứ nhất, $$\log p(v; \theta)$$, không phụ thuộc vào $$h$$ hay $$\mu_j$$. Do đó, ta không cần quan tâm đến nó.

Hạng tử thứ hai, $$\log p(h_{-j} \\| v; \theta)$$, cũng có thể bị loại bỏ bởi vì
$$
\begin{align}
    \begin{split}
        & \sum_h q(h|v; \phi) \log p(h_{-j} | v; \theta) \\
        =& \sum_{h_j, h_{-j}} q(h_j|v; \phi) q(h_{-j}|v; \phi) \log p(h_{-j} | v; \theta) \\
        =& \left[ \sum_{h_j} q(h_j|v; \phi) \right] \sum_{h_{-j}} q(h_{-j}|v; \phi) \log p(h_{-j} | v; \theta) \\
        =& \sum_{h_{-j}} q(h_{-j}|v; \phi) \log p(h_{-j} | v; \theta)
    \end{split}
\end{align}
$$
không phụ thuộc vào $$\mu_j$$.

Hạng tử thứ ba, $$\log p(h_j \\| h_{-j}, v; \theta)$$, có thể được biến đổi như sau.
$$
\begin{align}
    \begin{split}
        & \sum_h q(h|v; \phi) \log p(h_j | h_{-j}, v; \theta) \\
        =& \sum_{h_j, h_{-j}} q(h_j|v; \phi) q(h_{-j}|v; \phi) \log p(h_j | h_{-j}, v; \theta)  \\
        =& \sum_{h_{-j}} q(h_{-j}|v; \phi) \left[
            \sum_{h_j} q(h_j|v; \phi) \log p(h_j | h_{-j}, v; \theta)
        \right] \\
        =& \mathbb{E}_{h_{-j} \sim q(h_{-j}|v; \phi)} \left[
            \mu_j \log \eta_j
            + (1 - \mu_j) \log (1 - \eta_j)
        \right]
    \end{split}
\end{align}
$$

trong đó, $$\eta_j := p(h_j = 1 \\| h_{-j}, v; \theta)$$.

Tổng kết lại, phần liên quan đến $$\mu_j$$ của $$\text{ELBO}$$ là
$$
\begin{align}
    - \mathbb{E}_{h_{-j} \sim q(h_{-j}|v; \phi)} \left[
        \mu_j \log \dfrac{\mu_j}{\eta_j}
        + (1 - \mu_j) \log \dfrac{1 - \mu_j}{1 - \eta_j}
    \right]
\end{align}
$$

Lấy đạo hàm theo $$\mu_j$$, ta có
$$
\begin{align}
    \begin{split}
        & -\mathbb{E}_{h_{-j} \sim q(h_{-j}|v; \phi)} \left[
            \log \dfrac{\mu_j}{\eta_j}
            - \log \dfrac{1 - \mu_j}{1 - \eta_j}
        \right] \\
        =& \mathbb{E}_{h_{-j} \sim q(h_{-j}|v; \phi)} \left[
            \log \dfrac{\eta_j}{1 - \eta_j} - \log \dfrac{\mu_j}{1 - \mu_j}
        \right]
    \end{split}
\end{align}
$$

Đặt nó bằng $$0$$ và biến đổi, ta được
$$
\begin{align}
    \log \dfrac{\mu_j}{1 - \mu_j} =
        \mathbb{E}_{h_{-j} \sim q(h_{-j}|v; \phi)} \log \dfrac{\eta_j}{1 - \eta_j}
\end{align}
$$

hay
$$
\begin{align}
    \mu_j = \sigma \left( \mathbb{E}_{h_{-j} \sim q(h_{-j}|v; \phi)} \log \dfrac{\eta_j}{1 - \eta_j} \right)
\end{align}
$$

với $$\sigma(x) = \dfrac{1}{1 + e^{-x}}$$ là hàm sigmoid.

Đặt $$h^{(1)} = (h_1, \dots, h_{j-1}, 1, h_{j+1}, \dots, h_{d_h})$$ và $$h^{(0)} = (h_1, \dots, h_{j-1}, 0, h_{j+1}, \dots, h_{d_h})$$. Nói cách khác, $$h^{(t)}$$ là $$h$$ với $$h_j = t$$.

Khi đó,
$$
\begin{align}
    \begin{split}
        & \log \dfrac{\eta_j}{1 - \eta_j} \\
        &= \log \dfrac{p(h_j = 1| h_{-j}, v; \theta)}{p(h_j = 0| h_{-j}, v; \theta)} \\
        &= \log \dfrac{p(v, h^{(1)}; \theta)}{p(v, h^{(0)}; \theta)} \\
        &= \log \dfrac{\exp(-E(v, h^{(1)}; \theta))}{\exp(-E(v, h^{(0)}; \theta))} \\
        &= E(v, h^{(0)}; \theta) - E(v, h^{(1)}; \theta)
    \end{split}
\end{align}
$$

Hiệu số giữa hai hàm năng lượng chỉ thật sự khác biệt ở vị trí $$j$$. Do đó,
$$
\begin{align}
    \begin{split}
    & E(v, h^{(0)}; \theta) - E(v, h^{(1)}; \theta) \\
    &= \left(
        - \sum_{i} W_{ij} v_i \times 0
        - 2 \times \dfrac{1}{2} \sum_{l \neq j} A_{lj} h_l \times 0
        - b_j \times 0
    \right) \\
    & - \left(
        - \sum_{i} W_{ij} v_i \times 1
        - 2 \times \dfrac{1}{2} \sum_{l \neq j} A_{lj} h_l \times 1
        - b_j \times 1
    \right) \\
    &= \sum_{i} W_{ij} v_i + \sum_{l \neq j} A_{lj} h_l + b_j
    \end{split}
\end{align}
$$

Từ đó,
$$
\begin{align}
    \begin{split}
        & \mathbb{E}_{h_{-j} \sim q(h_{-j}|v; \phi)} \log \dfrac{p(h_j = 1 | h_{-j}, v; \theta)}{p(h_j = 0 | h_{-j}, v; \theta)} \\
        =& \sum_{i} W_{ij} x_i + \sum_{l \neq j} A_{lj} \mathbb{E}_{h_{-j} \sim q(h_{-j}|v; \phi)} h_l + b_j \\
        =& \sum_{i} W_{ij} x_i + \sum_{l \neq j} A_{lj} [1 \times \mu_l + 0 \times (1 - \mu_l)] + b_j \\
        =& \sum_{i} W_{ij} x_i + \sum_{l \neq j} A_{lj} \mu_l + b_j
    \end{split}
\end{align}
$$

Như vậy, ta đã chứng minh được ($$\ref{eq:mu_j}$$).

**Lưu ý** Trong trường hợp ta đang xét $$\{-1, 1\}^d$$ thì $$\mu_j$$ được tính theo công thức
$$
\begin{align}
    \mu_j = \sigma \left( \sum_{i} 2 W_{ij} v_i + \sum_{l \neq j} 2 A_{lj} (2 \mu_l - 1) + 2 b_j \right)
\end{align}
$$

## Hứa hẹn

Ở phần tiếp theo, chúng ta sẽ bàn về cách huấn luyện máy Boltzmann và máy Boltzmann giới hạn, sử dụng những biến đổi được cho ở trên.

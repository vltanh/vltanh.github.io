---
layout: distill
title: Hồi quy Softmax hay Tôi đã tốn một buổi chiều thứ Tư như thế nào?
date: 2021-06-16
description:
tags: math
categories: 

authors:
  - name: The-Anh Vu-Le
    affiliations:
      name: 
toc:
  - name: Bài toán Phân lớp Đơn nhãn
  - name: Mô hình Hồi quy Softmax
  - name: Áp dụng
  - name: Cài đặt
    subsections:
        - name: Hướng xuôi
        - name: Hướng ngược
---

```
Miễn trừ trách nhiêm:
- Có thể sai (vì mình ngu)
- Có thể không tốt (lý do như trên)
```

## Bài toán Phân lớp Đơn nhãn

Cho một bộ dữ liệu $$\mathcal{D}$$ là tập hợp $$N$$ điểm dữ liệu $$(\mathbf{x}^{(i)}, y^{(i)})$$ trong đó $$\mathbf{x}^{(i)} = (x^{(i)}_1, x^{(i)}_2, ..., x^{(i)}_D)^T \in \mathbb{R}^D$$ là đầu vào và $$y^{(i)} \in \{1, 2,..., C\}$$ là nhãn phân lớp đối với điểm dữ liệu thứ $$i=1..N$$. Ta mong muốn xây dựng một mô hình phân lớp dựa trên bộ dữ liệu đã cho.

## Mô hình Hồi quy Softmax

**Mô hình Hồi quy Softmax** có tham số là một ma trận trọng số thực $$\mathbf{W} = (w_{i,j}) \in \mathbb{R}^{C \times (D+1)}$$. Đối với một điểm dữ liệu đầu vào $$\mathbf{x} \in \mathbb{R}^D$$, nó đưa ra dự đoán thông qua các bước như sau:

1. Thêm giá trị hằng $$x_0 = 1$$ vào $$\mathbf{x}$$ để tạo thành đầu vào mới $$\mathbf{x'} := (1, x_1, x_2, ..., x_D)^T$$.
2. Tính $$\mathbf{z} = \mathbf{W} \mathbf{x'}$$. Nhận thấy $$\mathbf{z} = (z_1, z_2, ..., z_C)^T \in \mathbb{R}^C$$.
3. Tính $$\mathbf{h} = \sigma(\mathbf{z}) = (h_1, h_2, ..., h_C)^T$$ với

$$
    h_i = \dfrac{e^{z_1}}{\sum_{k=1}^{C}e^{z_k}}, i = 1..C
$$

Hàm $$\sigma$$ được gọi là **hàm softmax**. Có thể thấy, ở đây, nó ánh xạ từ $$\mathbb{R}^C \to [0, 1]^C$$.

Ta mong muốn tìm được $$\mathbf{W}$$ để $$h_c$$ xấp xỉ xác suất đầu vào $$\mathbf{x}$$ thuộc vào lớp $$c$$.

## Áp dụng

Để làm được điều này, ta đưa nó về bài toán tìm $$\mathbf{W}$$ để tối thiểu hàm lỗi $$\mathcal{L}(\mathcal{D}, \mathbf{W})$$. Hàm lỗi được chọn ở đây là

$$
    \mathcal{L}(\mathcal{D}, \mathbf{W})
    = \dfrac{1}{N}
    \sum_{n=1}^{N} \left(
        -\log h_{y^{(n)}}^{(n)}
    \right)
$$

Ta giải quyết nó bằng giải thuật Gradient Descent. Do đó, ta cần tìm được đạo hàm hàm lỗi đối với mỗi tham số (các giá trị $$w_{i,j}$$ trong ma trận trọng số $$\mathbf{W}$$).

Trước tiên, cần nói qua về đạo hàm của hàm softmax, cụ thể là đạo hàm của phần tử thứ $$i$$ trong vector kết quả, đối với phần tử thứ $$j$$ trong vector đầu vào:

$$
    \dfrac{\partial}{\partial z_j} h_i
    = \dfrac{\partial}{\partial z_j} \dfrac{e^{\mathbf{z}_i}}{\sum_{k=1}^{n} e^{\mathbf{z}_k}}
    = \dfrac{1}{\left(\sum_{k=1}^{n} e^{\mathbf{z}_k} \right)^2}
    \left[
        \left( \dfrac{\partial}{\partial z_j} e^{\mathbf{z}_i} \right)
        \left( \sum_{k=1}^{n} e^{\mathbf{z}_k} \right )
        -
        e^{\mathbf{z}_i}
        \dfrac{\partial}{\partial z_j} \left( \sum_{k=1}^{n} e^{\mathbf{z}_k} \right )
    \right]
$$

Định nghĩa $$\delta_{i, j} = 1$$ khi $$i = j$$ và bằng $$0$$ trong trường hợp khác, ta có

$$
    \dfrac{\partial}{\partial z_j} h_i
    = \dfrac{1}{\left(\sum_{k=1}^{n} e^{\mathbf{z}_k} \right)^2}
    \left[
        \delta_{i, j} e^{z_i}
        \left( \sum_{k=1}^{n} e^{\mathbf{z}_k} \right )
        -
        e^{\mathbf{z}_i} e^{\mathbf{z}_j}
    \right]
    =  \dfrac{e^{z_i}}{\sum_{k=1}^{n} e^{\mathbf{z}_k}}
    \left[
        \delta_{i, j}
        -
        \dfrac{e^{z_j}}{\sum_{k=1}^{n} e^{\mathbf{z}_k}}
    \right]
$$

Như vậy,

$$
    \dfrac{\partial}{\partial z_j} h_i = h_i (\delta_{i, j} - h_j)
$$

Từ đó, ta có thể tính được

$$
    \dfrac{\partial}{\partial w_{i,j}} \mathcal{L}(\mathcal{D}, \mathbf{W})
    = \dfrac{1}{N} \sum_{n=1}^{N} - \dfrac{\partial}{\partial w_{i,j}} \log h_{y^{(n)}}^{(n)}
    = \dfrac{1}{N} \sum_{n=1}^{N} - \dfrac{1}{h_{y^{(n)}}^{(n)}} \dfrac{\partial h_{y^{(n)}}^{(n)}}{\partial w_{i,j}}
$$

Sử dụng quy tắc mắt xích, ta có

$$
    \dfrac{\partial}{\partial w_{i,j}} \mathcal{L}(\mathcal{D}, \mathbf{W})
    = \dfrac{1}{N}
    \sum_{n=1}^{N}
    \left[
        - \dfrac{1}{h_{y^{(n)}}^{(n)}}
        \sum_{k=1}^{C}
            \dfrac{\partial h_{y^{(n)}}^{(n)}}{\partial z^{(n)}_k}
            \dfrac{\partial z^{(n)}_k}{\partial w_{i,j}}
    \right]
    = \dfrac{1}{N}
    \sum_{n=1}^{N}
    \left[
        - \sum_{k=1}^{C} (\delta_{y^{(n)}, k} - h^{(n)}_k)
        \dfrac{\partial z^{(n)}_k}{\partial w_{i,j}}
    \right]
$$

Vì $$z^{(n)}\_k = \sum_{t=1}^{D} w_{k, t} x^{(n)}_t$$ nên

$$
    \dfrac{\partial}{\partial w_{i,j}} \mathcal{L}(\mathcal{D}, \mathbf{W})
    = \dfrac{1}{N}
    \sum_{n=1}^{N}
    \left[
        - \sum_{k=1}^{C} (\delta_{y^{(n)}, k} - h^{(n)}_k)
        \delta_{k, i} x^{(n)}_j
    \right]
    = \dfrac{1}{N}
    \sum_{n=1}^{N} -
        (\delta_{y^{(n)}, i} - h^{(n)}_i)
         x^{(n)}_j
$$

Như vậy, để giải quyết bài toán tìm $$\mathbf{W}$$ để tối thiểu $$\mathcal{L}(\mathcal{D}, \mathbf{W})$$, ta có thể áp dụng giải thuật Gradient Descent với

$$
    \dfrac{\partial}{\partial w_{i,j}} \mathcal{L}(\mathcal{D}, \mathbf{W})
    = \dfrac{1}{N}
    \sum_{n=1}^{N} -
        (\delta_{y^{(n)}, i} - h^{(n)}_i)
         x^{(n)}_j
$$

## Cài đặt

### Hướng xuôi

Có:

```
X: (D, N)
y: (N,)
W: (C, D+1)
```

Thêm giá trị hằng

```python
X_ = np.ones((D+1, N))    # X_: (D+1, N)
X_[1:] = X
```

Đưa ra dự đoán

```python
z = W @ X_                # z: (C, N)
h = softmax(z, axis=0)    # h: (C, N)  
```

### Hướng ngược

Ta muốn tìm ma trận `dW` bằng numpy sao cho phần tử tại vị trí $$(i, j)$$ của ma trận này bằng giá trị đạo hàm của hàm lỗi so với $$w_{i, j}$$, dựa trên công thức

$$
    \dfrac{\partial}{\partial w_{i,j}} \mathcal{L}(\mathcal{D}, \mathbf{W})
    = \dfrac{1}{N}
    \sum_{n=1}^{N} -
        (\delta_{y^{(n)}, i} - h^{(n)}_i)
         x^{(n)}_j
$$

#### Cách 1

Một cách cài đặt ngây ngô là

```python
dW = np.zeros((N, C, D+1))     # dW: (N, C, D+1)
for n in range(N):
    for i in range(C):
        for j in range(D+1):
            dW[n, i, j] = - ((i == y[n]) - h[i, n]) * X_[j, n]
dW = dW.mean(0)                # dW: (C, D+1)
```

#### Cách 2

Cải tiến đơn giản để hạn chế vòng lặp `n`:

```python
dW = np.zeros((C, D+1))    # dW: (C, D+1)
for i in range(C):
    for j in range(D+1):
        dW[i, j] -= (((i == y) - h[i]) * X_[j]).mean()
```

#### Cách 3

Nhận thấy dòng `4` có thể tách làm 2 bước

```python
dW[i, j] -= ((i == y) * X_[j]).mean()      # (1)

dW[i, j] += (h[i]     * X_[j]).mean()      # (2)
```

Công thức `(2)` cho thấy `dW[i, j]` chỉ đơn giản là tích vô hướng (chia `N`) của `h[i]` và `X_[j]`. Nói cách khác, hoàn toàn có thể rút gọn lại thành

```python
dW = h @ X_.T / N        # (C, N) x (N, D+1) => (C, D+1)
```

Đoạn mã bây giờ nhìn như thế này, thật ra thì cũng chẳng hơn cái trên là bao vì kiểu gì cũng 2 vòng lặp, chỉ là bỏ bớt tính toán tí.

```python
dW = h @ X_.T / N    # dW: (C, D+1)
for i in range(C):
    for j in range(D+1):
        dW[i, j] -= ((i == y) * X_[j]).mean()
```

Nhìn vào đoạn mã, có thể nhận xét là với mỗi giá trị của `i` thì (1) chỉ có dòng thứ `i` của `dW` được cập nhật; và (2) cập nhật bằng cách trừ đi một lượng bằng vector trung bình của các điểm trong tập dữ liệu mà thuộc lớp `i`.

Đúng theo suy nghĩ này, có thể viết lại:

```python
dW = h @ X_.T / N    # dW: (C, D+1)
for i in range(C):
    dW[i] -= X_[j, i == y].sum(axis=1) / N
```

Lưu ý thay vì `.mean()` thì phải thay bằng `.sum() / N` vì việc slice cột theo điều kiện `i == y` đã làm giảm số lượng cột trong `X_`.

#### Cách 4

Thực tế thì đến đây code đã chạy nhanh hơn hẳn rồi (chắc phải gấp 10 lần cái 3 vòng for ban đầu). Nhưng mà tại lỡ rồi làm cho tới chứ (với không benchmark kỹ nên ai biết được).

Cũng cùng ý tưởng trên, bây giờ mình cần một ma trận, gọi là `M` đi, có `C` dòng sao cho dòng `c` là tổng các vector (chuyển vị) của các điểm dữ liệu thuộc lớp `c`. Nói cách khác, mình đang tìm cách để chọn ra các dòng trong `X_.T` để cộng lại thành các dòng trong `M`.

Nếu mà bạn học đại số tuyến tính và giáo viên của bạn cũng ổn áp như Gilbert Strang (hoặc bạn tự đọc gì đấy) thì chắc là các bạn đã biết phép nhân ma trận $$EF$$ sẽ tạo ra ma trận $$G$$ sao cho dòng thứ $$c$$ của nó là tổ hợp tuyến tính của các dòng của $F$ với hệ số là các phần tử của dòng thứ $$c$$ của $$E$$.

Nghe có liên quan rồi chứ? Nếu `X_.T` của mình là $$F$$ trong nhận xét trên thì $$G$$ sẽ là `M` mình cần tìm. Vậy thì $$E$$ là gì? $$E$$ sẽ là ma trận nhị phân nhằm "chọn ra" các dòng, như vậy $$e_{c, i} = 1$$ khi mình muốn chọn dòng `i` trong `X_.T` để thêm nó vào dòng `c` trong `M`. Nói cách khác, $$e_{c, i} = 1$$ khi điểm dữ liệu thứ $$i$$ của mình thuộc lớp $$c$$. Vậy $$E$$ không đâu khác chính là ma trận one-hot encoding!

Tìm trên Google sẽ thấy cách tạo ma trận one-hot encoding khá đơn giản

```python
I = np.eye(C) # I: (C, C)
E = I[y].T    # E: (C, N)
```

Một cách hiểu đơn giản là `E` được tạo thành bằng cách lần lượt lấy từng dòng của ma trận đơn vị `I`, dòng được lấy thứ `i` là `y[i]`.

Như vậy ta có thể tính được

```python
M = E @ X_.T    # M: (C, D+1)
```

Tổng hợp lại, ta có mã nguồn cuối cùng:

```python
dW = (h - np.eye(C)[y].T) @ X_.T / N    # dW: (C, D+1)
```

